import asyncio
import base64
import hashlib
import importlib
import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

import gemini_webapi_openai_bridge as bridge


class BridgeHelpersTest(unittest.TestCase):
    def test_loads_cookie_auth_from_local_file(self):
        with tempfile.TemporaryDirectory() as directory:
            auth_path = Path(directory) / "gemini-web-auth.json"
            auth_path.write_text(json.dumps({
                "__Secure-1PSID": "file-cookie",
                "__Secure-1PSIDTS": "file-ts",
                "cookies": [
                    {"name": "__Host-GAPS", "value": "host-gaps", "domain": "accounts.google.com", "path": "/"},
                    {"name": "", "value": "ignored"},
                ],
            }), encoding="utf-8")
            previous = os.environ.get("GEMINI_WEB_AUTH_PATH")
            os.environ["GEMINI_WEB_AUTH_PATH"] = str(auth_path)
            try:
                auth = bridge.load_gemini_web_auth()
            finally:
                if previous is None:
                    os.environ.pop("GEMINI_WEB_AUTH_PATH", None)
                else:
                    os.environ["GEMINI_WEB_AUTH_PATH"] = previous

        self.assertEqual(auth.secure_1psid, "file-cookie")
        self.assertEqual(auth.secure_1psidts, "file-ts")
        self.assertEqual(auth.cookies, [
            {"name": "__Host-GAPS", "value": "host-gaps", "domain": "accounts.google.com", "path": "/"},
        ])

    def test_builds_cookie_jar_from_full_cookie_export(self):
        auth = bridge.GeminiWebAuth(
            secure_1psid="file-cookie",
            secure_1psidts="file-ts",
            cookies=[
                {"name": "__Host-GAPS", "value": "host-gaps", "domain": "accounts.google.com", "path": "/"},
                {"name": "__Secure-1PSID", "value": "stale-cookie", "domain": ".google.com", "path": "/"},
            ],
        )

        jar = bridge.build_cookie_jar(auth)
        values = {cookie.name: cookie.value for cookie in jar.jar}

        self.assertEqual(values["__Host-GAPS"], "host-gaps")
        self.assertEqual(values["__Secure-1PSID"], "file-cookie")
        self.assertEqual(values["__Secure-1PSIDTS"], "file-ts")

    def test_build_cookie_jar_ignores_expired_full_cookies(self):
        auth = bridge.GeminiWebAuth(
            secure_1psid="file-cookie",
            secure_1psidts="file-ts",
            cookies=[
                {"name": "__Secure-1PSIDRTS", "value": "expired-rts", "domain": ".google.com", "path": "/", "expires": time.time() - 60},
                {"name": "__Secure-1PSIDCC", "value": "fresh-cc", "domain": ".google.com", "path": "/", "expires": time.time() + 60},
            ],
        )

        jar = bridge.build_cookie_jar(auth)
        values = {cookie.name: cookie.value for cookie in jar.jar}

        self.assertNotIn("__Secure-1PSIDRTS", values)
        self.assertEqual(values["__Secure-1PSIDCC"], "fresh-cc")
        self.assertEqual(values["__Secure-1PSID"], "file-cookie")

    def test_gemini_client_timeout_uses_env_value(self):
        previous = os.environ.get("GEMINI_CLIENT_TIMEOUT_SECONDS")
        os.environ["GEMINI_CLIENT_TIMEOUT_SECONDS"] = "240"
        try:
            timeout = bridge.get_gemini_client_timeout_seconds()
        finally:
            if previous is None:
                os.environ.pop("GEMINI_CLIENT_TIMEOUT_SECONDS", None)
            else:
                os.environ["GEMINI_CLIENT_TIMEOUT_SECONDS"] = previous

        self.assertEqual(timeout, 240.0)

    def test_gemini_client_timeout_falls_back_for_invalid_env_value(self):
        previous = os.environ.get("GEMINI_CLIENT_TIMEOUT_SECONDS")
        os.environ["GEMINI_CLIENT_TIMEOUT_SECONDS"] = "invalid"
        try:
            timeout = bridge.get_gemini_client_timeout_seconds()
        finally:
            if previous is None:
                os.environ.pop("GEMINI_CLIENT_TIMEOUT_SECONDS", None)
            else:
                os.environ["GEMINI_CLIENT_TIMEOUT_SECONDS"] = previous

        self.assertEqual(timeout, bridge.DEFAULT_CLIENT_TIMEOUT_SECONDS)

    def test_apply_cookie_auth_keeps_client_cookie_container(self):
        client = FakeCookieClient()
        original_cookies = client.cookies

        bridge.apply_cookie_auth(client, bridge.GeminiWebAuth(
            secure_1psid="file-cookie",
            secure_1psidts="file-ts",
            cookies=[{"name": "__Host-GAPS", "value": "host-gaps", "domain": "accounts.google.com", "path": "/"}],
        ))

        self.assertIs(client.cookies, original_cookies)
        self.assertIn(("__Host-GAPS", "host-gaps", "accounts.google.com", "/"), client.cookies.items)
        self.assertIn(("__Secure-1PSID", "file-cookie", ".google.com", "/"), client.cookies.items)

    def test_full_cookie_auth_uses_isolated_cache_path(self):
        with tempfile.TemporaryDirectory() as directory:
            previous = os.environ.get("GEMINI_COOKIE_PATH")
            os.environ["GEMINI_COOKIE_PATH"] = directory
            try:
                bridge.configure_gemini_cookie_path(bridge.GeminiWebAuth(
                    secure_1psid="file-cookie",
                    secure_1psidts="file-ts",
                    cookies=[{"name": "__Host-GAPS", "value": "host-gaps"}],
                ))
                configured_path = Path(os.environ["GEMINI_COOKIE_PATH"])
            finally:
                if previous is None:
                    os.environ.pop("GEMINI_COOKIE_PATH", None)
                else:
                    os.environ["GEMINI_COOKIE_PATH"] = previous

        self.assertEqual(configured_path, Path(directory) / bridge.FULL_COOKIE_CACHE_DIR_NAME)

    def test_two_cookie_auth_keeps_default_cache_path(self):
        with tempfile.TemporaryDirectory() as directory:
            previous = os.environ.get("GEMINI_COOKIE_PATH")
            os.environ["GEMINI_COOKIE_PATH"] = directory
            try:
                bridge.configure_gemini_cookie_path(bridge.GeminiWebAuth(
                    secure_1psid="file-cookie",
                    secure_1psidts="file-ts",
                    cookies=[],
                ))
                configured_path = Path(os.environ["GEMINI_COOKIE_PATH"])
            finally:
                if previous is None:
                    os.environ.pop("GEMINI_COOKIE_PATH", None)
                else:
                    os.environ["GEMINI_COOKIE_PATH"] = previous

        self.assertEqual(configured_path, Path(directory))

    def test_cookie_cache_path_uses_short_hash_for_long_cookie_values(self):
        from curl_cffi.requests import Cookies

        rotate_1psidts = importlib.import_module("gemini_webapi.utils.rotate_1psidts")

        long_cookie = "g." + ("a" * 520)
        expected_digest = hashlib.sha256(long_cookie.encode("utf-8")).hexdigest()
        with tempfile.TemporaryDirectory() as directory:
            previous = os.environ.get("GEMINI_COOKIE_PATH")
            os.environ["GEMINI_COOKIE_PATH"] = directory
            try:
                bridge.configure_safe_gemini_cookie_cache()
                cookies = Cookies()
                cookies.set("__Secure-1PSID", long_cookie, domain=".google.com")
                cache_path = rotate_1psidts._get_cookies_cache_path(cookies)
            finally:
                if previous is None:
                    os.environ.pop("GEMINI_COOKIE_PATH", None)
                else:
                    os.environ["GEMINI_COOKIE_PATH"] = previous

        self.assertIsNotNone(cache_path)
        self.assertEqual(cache_path.name, f"{bridge.SAFE_COOKIE_CACHE_PREFIX}{expected_digest}.json")
        self.assertLess(len(cache_path.name.encode("utf-8")), 255)
        self.assertNotIn(long_cookie, cache_path.name)

    def test_bridge_reloads_auth_file_when_cookie_values_change(self):
        with tempfile.TemporaryDirectory() as directory:
            auth_path = Path(directory) / "gemini-web-auth.json"
            auth_path.write_text(json.dumps({
                "__Secure-1PSID": "old-cookie",
                "__Secure-1PSIDTS": "old-ts",
            }), encoding="utf-8")
            previous = os.environ.get("GEMINI_WEB_AUTH_PATH")
            os.environ["GEMINI_WEB_AUTH_PATH"] = str(auth_path)
            try:
                client = FakeInitializedClient()
                gemini_bridge = bridge.GeminiBridge(
                    secure_1psid="old-cookie",
                    secure_1psidts="old-ts",
                    cookies=[],
                    proxy=None,
                    output_dir=Path(directory),
                    auth_file_stamp=bridge.get_gemini_web_auth_file_stamp(),
                )
                gemini_bridge._client = client

                auth_path.write_text(json.dumps({
                    "__Secure-1PSID": "new-cookie",
                    "__Secure-1PSIDTS": "new-ts",
                    "cookies": [{"name": "__Host-GAPS", "value": "new-gaps"}],
                }), encoding="utf-8")
                os.utime(auth_path, None)
                asyncio.run(gemini_bridge.reload_auth_if_changed())
            finally:
                if previous is None:
                    os.environ.pop("GEMINI_WEB_AUTH_PATH", None)
                else:
                    os.environ["GEMINI_WEB_AUTH_PATH"] = previous

        self.assertTrue(client.closed)
        self.assertIsNone(gemini_bridge._client)
        self.assertEqual(gemini_bridge.secure_1psid, "new-cookie")
        self.assertEqual(gemini_bridge.secure_1psidts, "new-ts")
        self.assertEqual(gemini_bridge.cookies, [{"name": "__Host-GAPS", "value": "new-gaps", "domain": ".google.com", "path": "/"}])

    def test_bridge_passes_configured_timeout_to_client_init(self):
        with tempfile.TemporaryDirectory() as directory:
            gemini_bridge = bridge.GeminiBridge(
                secure_1psid="cookie",
                secure_1psidts="ts",
                cookies=[],
                proxy=None,
                output_dir=Path(directory),
                client_timeout=180.0,
            )
            fake_client = FakeInitClient()
            original_module = sys.modules.get("gemini_webapi")
            sys.modules["gemini_webapi"] = type("FakeGeminiWebApi", (), {"GeminiClient": lambda *args, **kwargs: fake_client})
            try:
                client = asyncio.run(gemini_bridge.client())
            finally:
                if original_module is None:
                    sys.modules.pop("gemini_webapi", None)
                else:
                    sys.modules["gemini_webapi"] = original_module

        self.assertIs(client, fake_client)
        self.assertEqual(fake_client.init_kwargs["timeout"], 180.0)

    def test_bridge_retries_once_after_auth_like_image_error(self):
        with tempfile.TemporaryDirectory() as directory:
            gemini_bridge = bridge.GeminiBridge(
                secure_1psid="cookie",
                secure_1psidts="ts",
                cookies=[],
                proxy=None,
                output_dir=Path(directory),
            )
            stale_client = FakeGenerateClient([
                FakeGeminiResponse(text="您登录了吗？我可以搜索图片，但目前似乎无法为您创建任何图片。"),
            ])
            fresh_client = FakeGenerateClient([
                FakeGeminiResponse(images=[FakeGeneratedImage()]),
            ])
            clients = [stale_client, fresh_client]

            async def fake_client():
                gemini_bridge._client = clients.pop(0)
                return gemini_bridge._client

            gemini_bridge.client = fake_client
            images = asyncio.run(gemini_bridge.generate_images(
                prompt="red square",
                count=1,
                mode="generation",
                size="1024x1024",
                files=[],
                has_mask=False,
            ))

        self.assertEqual(base64.b64decode(images[0]), b"fake-png")
        self.assertTrue(stale_client.closed)
        self.assertFalse(fresh_client.closed)
        self.assertEqual(stale_client.call_count, 1)
        self.assertEqual(fresh_client.call_count, 1)

    def test_extracts_responses_text_and_data_url_images(self):
        with tempfile.TemporaryDirectory() as directory:
            result = bridge.extract_responses_input({
                "input": [
                    {
                        "role": "user",
                        "content": [
                            {"type": "input_text", "text": "Describe this image."},
                            {"type": "input_image", "image_url": "data:image/png;base64,ZmFrZS1wbmc="},
                        ],
                    },
                ],
            }, Path(directory))

            self.assertEqual(result.prompt, "User:\nDescribe this image.")
            self.assertEqual(len(result.files), 1)
            self.assertEqual(result.files[0].read_bytes(), b"fake-png")
            self.assertEqual(result.files[0].suffix, ".png")

    def test_extracts_chat_text_and_data_url_images(self):
        with tempfile.TemporaryDirectory() as directory:
            result = bridge.extract_chat_messages_input({
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": "Reverse engineer a prompt."},
                            {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,ZmFrZS1qcGc="}},
                        ],
                    },
                ],
            }, Path(directory))

            self.assertEqual(result.prompt, "User:\nReverse engineer a prompt.")
            self.assertEqual(len(result.files), 1)
            self.assertEqual(result.files[0].read_bytes(), b"fake-jpg")
            self.assertEqual(result.files[0].suffix, ".jpg")

    def test_extracts_text_from_responses_payload(self):
        text = bridge.extract_responses_text({
            "input": [
                {"role": "system", "content": [{"type": "input_text", "text": "Reply as JSON."}]},
                {"role": "user", "content": [{"type": "input_text", "text": "Create a storyboard."}]},
            ],
        })

        self.assertEqual(text, "System instruction:\nReply as JSON.\n\nUser:\nCreate a storyboard.")

    def test_extracts_text_from_chat_messages_payload(self):
        text = bridge.extract_chat_messages_text({
            "messages": [
                {"role": "system", "content": "Reply tersely."},
                {"role": "user", "content": [{"type": "text", "text": "Improve this prompt."}]},
            ],
        })

        self.assertEqual(text, "System instruction:\nReply tersely.\n\nUser:\nImprove this prompt.")

    def test_builds_openai_compatible_text_responses(self):
        responses_payload = bridge.build_responses_response("hello", model="gemini-web")
        chat_payload = bridge.build_chat_completion_response("hello", model="gemini-web")

        self.assertEqual(responses_payload["output_text"], "hello")
        self.assertEqual(responses_payload["output"][0]["content"][0]["text"], "hello")
        self.assertEqual(chat_payload["choices"][0]["message"]["content"], "hello")

    def test_wraps_generation_prompt_to_force_generated_images(self):
        prompt = bridge.build_gemini_prompt(
            mode="generation",
            prompt="a clean product render",
            size="1024x1024",
            has_mask=False,
        )

        self.assertIn("Generate a new image", prompt)
        self.assertIn("a clean product render", prompt)
        self.assertIn("1024x1024", prompt)
        self.assertNotIn("Nano Banana", prompt)
        self.assertNotIn("banana", prompt.lower())

    def test_wraps_edit_prompt_with_mask_context(self):
        prompt = bridge.build_gemini_prompt(
            mode="edit",
            prompt="replace the marked area with glass",
            size="1024x1024",
            has_mask=True,
        )

        self.assertIn("Edit the attached image", prompt)
        self.assertIn("mask", prompt.lower())
        self.assertIn("replace the marked area with glass", prompt)
        self.assertNotIn("Nano Banana", prompt)
        self.assertNotIn("banana", prompt.lower())

    def test_extracts_b64_json_from_saved_generated_image(self):
        with tempfile.TemporaryDirectory() as directory:
            image = FakeGeneratedImage()

            encoded = asyncio.run(bridge.generated_image_to_b64_json(image, Path(directory), "result.png"))

        self.assertEqual(base64.b64decode(encoded), b"fake-png")

    def test_models_endpoint_accepts_authenticated_request(self):
        previous = os.environ.get("GEMINI_BRIDGE_API_KEY")
        os.environ["GEMINI_BRIDGE_API_KEY"] = "test-key"
        try:
            app = bridge.create_app()
            response = TestClient(app).get("/v1/models", headers={"Authorization": "Bearer test-key"})
        finally:
            if previous is None:
                os.environ.pop("GEMINI_BRIDGE_API_KEY", None)
            else:
                os.environ["GEMINI_BRIDGE_API_KEY"] = previous

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"][0]["id"], bridge.DEFAULT_MODEL)


class FakeGeneratedImage:
    async def save(self, path, filename, verbose=False):
        output_path = Path(path) / filename
        output_path.write_bytes(b"fake-png")
        return str(output_path)


class FakeInitializedClient:
    def __init__(self):
        self.closed = False

    async def close(self):
        self.closed = True


class FakeInitClient:
    def __init__(self):
        self.init_kwargs = {}

    async def init(self, **kwargs):
        self.init_kwargs = kwargs


class FakeSettableCookies:
    def __init__(self):
        self.items = []

    def set(self, name, value, domain=None, path=None):
        self.items.append((name, value, domain, path))


class FakeCookieClient:
    def __init__(self):
        self.cookies = FakeSettableCookies()


class FakeGeminiResponse:
    def __init__(self, *, images=None, text=""):
        self.images = images or []
        self.text = text


class FakeGenerateClient:
    def __init__(self, responses):
        self.closed = False
        self.call_count = 0
        self.responses = list(responses)

    async def generate_content(self, *args, **kwargs):
        self.call_count += 1
        return self.responses.pop(0)

    async def close(self):
        self.closed = True


if __name__ == "__main__":
    unittest.main()
