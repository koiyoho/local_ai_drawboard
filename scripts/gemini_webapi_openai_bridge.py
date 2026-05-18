from __future__ import annotations

import argparse
import asyncio
import base64
from dataclasses import dataclass
import hashlib
import importlib
import json
import os
import tempfile
import time
import uuid
from pathlib import Path
from typing import Any

try:
    from fastapi import Request
except ImportError:
    Request = Any  # type: ignore[assignment]


DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8317
DEFAULT_MODEL = "gemini-web"
DEFAULT_CLIENT_TIMEOUT_SECONDS = 120.0
SAFE_COOKIE_CACHE_PREFIX = ".cached_cookies_sha256_"
FULL_COOKIE_CACHE_DIR_NAME = "full-cookie-auth-cache"
AUTH_RECOVERY_MESSAGES = [
    "unauthenticated",
    "not authenticated",
    "cookies have expired",
    "signed out",
    "登录了吗",
    "无法为您创建任何图片",
    "can't create it right now",
    "image creation isn't available",
]


def get_gemini_client_timeout_seconds() -> float:
    raw_value = os.getenv("GEMINI_CLIENT_TIMEOUT_SECONDS", "").strip()
    if not raw_value:
        return DEFAULT_CLIENT_TIMEOUT_SECONDS
    try:
        parsed = float(raw_value)
    except ValueError:
        return DEFAULT_CLIENT_TIMEOUT_SECONDS
    return parsed if parsed > 0 else DEFAULT_CLIENT_TIMEOUT_SECONDS


@dataclass
class TextInput:
    prompt: str
    files: list[Path]


@dataclass
class GeminiWebAuth:
    secure_1psid: str
    secure_1psidts: str
    cookies: list[dict[str, Any]]


@dataclass(frozen=True)
class AuthFileStamp:
    path: Path
    mtime_ns: int | None
    size: int | None
    digest: str | None


def load_gemini_web_auth() -> GeminiWebAuth:
    env_1psid = os.getenv("GEMINI_SECURE_1PSID") or os.getenv("__SECURE_1PSID") or ""
    env_1psidts = os.getenv("GEMINI_SECURE_1PSIDTS") or os.getenv("__SECURE_1PSIDTS") or ""
    file_auth = load_gemini_web_auth_file()
    return GeminiWebAuth(
        secure_1psid=file_auth.secure_1psid or env_1psid.strip(),
        secure_1psidts=file_auth.secure_1psidts or env_1psidts.strip(),
        cookies=file_auth.cookies,
    )


def get_gemini_web_auth_path() -> Path:
    return Path(os.getenv("GEMINI_WEB_AUTH_PATH") or Path.cwd() / ".codex" / "gemini-web-auth.json")


def get_gemini_web_auth_file_stamp() -> AuthFileStamp:
    auth_path = get_gemini_web_auth_path()
    try:
        stats = auth_path.stat()
        content = auth_path.read_bytes()
    except FileNotFoundError:
        return AuthFileStamp(auth_path, None, None, None)
    return AuthFileStamp(auth_path, stats.st_mtime_ns, stats.st_size, hashlib.sha256(content).hexdigest())


def load_gemini_web_auth_file() -> GeminiWebAuth:
    auth_path = get_gemini_web_auth_path()
    try:
        payload = json.loads(auth_path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return GeminiWebAuth("", "", [])
    secure_1psid = payload.get("__Secure-1PSID") or payload.get("secure1psid")
    secure_1psidts = payload.get("__Secure-1PSIDTS") or payload.get("secure1psidts")
    cookies = normalize_saved_cookies(payload.get("cookies"))
    return GeminiWebAuth(
        secure_1psid=secure_1psid.strip() if isinstance(secure_1psid, str) else "",
        secure_1psidts=secure_1psidts.strip() if isinstance(secure_1psidts, str) else "",
        cookies=cookies,
    )


def normalize_saved_cookies(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []

    cookies: list[dict[str, Any]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        name = item.get("name")
        cookie_value = item.get("value")
        if not isinstance(name, str) or not name.strip() or not isinstance(cookie_value, str):
            continue
        domain = item.get("domain")
        path = item.get("path")
        expires = item.get("expires")
        normalized: dict[str, Any] = {
            "name": name.strip(),
            "value": cookie_value,
            "domain": domain.strip() if isinstance(domain, str) and domain.strip() else ".google.com",
            "path": path.strip() if isinstance(path, str) and path.strip() else "/",
        }
        if isinstance(expires, (int, float)):
            normalized["expires"] = expires
        cookies.append(normalized)

    return cookies


def build_cookie_jar(auth: GeminiWebAuth) -> Any:
    from curl_cffi.requests import Cookies

    jar = Cookies()
    populate_cookie_jar(jar, auth)
    return jar


def populate_cookie_jar(jar: Any, auth: GeminiWebAuth) -> Any:
    for cookie in auth.cookies:
        name = cookie.get("name")
        value = cookie.get("value")
        if not isinstance(name, str) or not isinstance(value, str):
            continue
        expires = cookie.get("expires")
        if isinstance(expires, (int, float)) and expires < time.time():
            continue
        jar.set(
            name,
            value,
            domain=str(cookie.get("domain") or ".google.com"),
            path=str(cookie.get("path") or "/"),
        )

    if auth.secure_1psid:
        jar.set("__Secure-1PSID", auth.secure_1psid, domain=".google.com", path="/")
    if auth.secure_1psidts:
        jar.set("__Secure-1PSIDTS", auth.secure_1psidts, domain=".google.com", path="/")

    return jar


def apply_cookie_auth(client: Any, auth: GeminiWebAuth) -> None:
    populate_cookie_jar(client.cookies, auth)


def configure_gemini_cookie_path(auth: GeminiWebAuth) -> None:
    """
    gemini-webapi tries cached cookies before the cookies passed by the caller.
    When an admin imports a full browser cookie set, keep it isolated from any
    stale two-cookie cache created by older bridge versions.
    """

    if not auth.cookies:
        os.environ.setdefault("GEMINI_COOKIE_PATH", str(Path.cwd() / ".codex" / "gemini-webapi-cookies"))
        return

    configured_path = Path(os.getenv("GEMINI_COOKIE_PATH") or Path.cwd() / ".codex" / "gemini-webapi-cookies")
    os.environ["GEMINI_COOKIE_PATH"] = str(configured_path / FULL_COOKIE_CACHE_DIR_NAME)


def configure_safe_gemini_cookie_cache() -> None:
    """
    gemini-webapi 1.18.x uses the full __Secure-1PSID value in cache filenames.
    Google session cookies can exceed Linux's 255-byte filename limit, so keep
    the library behavior but replace the filename key with a stable hash.
    """

    try:
        rotate_module = importlib.import_module("gemini_webapi.utils.rotate_1psidts")
        token_module = importlib.import_module("gemini_webapi.utils.get_access_token")
    except ImportError:
        return

    extract_cookie_value = getattr(rotate_module, "_extract_cookie_value", None)
    get_cookie_cache_dir = getattr(rotate_module, "_get_cookie_cache_dir", None)
    if not callable(extract_cookie_value) or not callable(get_cookie_cache_dir):
        return

    def get_safe_cookies_cache_path(cookies: Any, verbose: bool = False) -> Path | None:
        secure_1psid = extract_cookie_value(cookies, "__Secure-1PSID")
        if not secure_1psid:
            logger = getattr(rotate_module, "logger", None)
            if verbose and logger is not None:
                logger.warning("Cannot save cookies: __Secure-1PSID not found.")
            return None

        digest = hashlib.sha256(str(secure_1psid).encode("utf-8")).hexdigest()
        return get_cookie_cache_dir() / f"{SAFE_COOKIE_CACHE_PREFIX}{digest}.json"

    rotate_module._get_cookies_cache_path = get_safe_cookies_cache_path
    token_module._get_cookies_cache_path = get_safe_cookies_cache_path


def extract_responses_input(payload: dict[str, Any], directory: Path) -> TextInput:
    input_value = payload.get("input")
    if isinstance(input_value, str):
        return TextInput(input_value.strip(), [])
    if not isinstance(input_value, list):
        return TextInput("", [])
    messages = [format_message_text(item) for item in input_value]
    files = extract_message_files(input_value, directory)
    return TextInput("\n\n".join(filter(None, messages)).strip(), files)


def extract_chat_messages_input(payload: dict[str, Any], directory: Path) -> TextInput:
    messages = payload.get("messages")
    if not isinstance(messages, list):
        return TextInput("", [])
    return TextInput(
        "\n\n".join(filter(None, (format_message_text(message) for message in messages))).strip(),
        extract_message_files(messages, directory),
    )


def extract_responses_text(payload: dict[str, Any]) -> str:
    return extract_responses_input(payload, Path(tempfile.gettempdir())).prompt


def extract_chat_messages_text(payload: dict[str, Any]) -> str:
    return extract_chat_messages_input(payload, Path(tempfile.gettempdir())).prompt


def format_message_text(message: Any) -> str:
    if not isinstance(message, dict):
        return ""
    role = str(message.get("role") or "user")
    text = extract_content_text(message.get("content"))
    if not text:
        return ""
    if role == "system":
        label = "System instruction"
    elif role == "assistant":
        label = "Assistant"
    else:
        label = "User"
    return f"{label}:\n{text}"


def extract_content_text(content: Any) -> str:
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                text = item.get("text")
                if isinstance(text, str):
                    parts.append(text)
        return "\n".join(part.strip() for part in parts if part and part.strip()).strip()
    return ""


def extract_message_files(messages: list[Any], directory: Path) -> list[Path]:
    directory.mkdir(parents=True, exist_ok=True)
    files: list[Path] = []
    for message in messages:
        if not isinstance(message, dict):
            continue
        content = message.get("content")
        if not isinstance(content, list):
            continue
        for item in content:
            if not isinstance(item, dict):
                continue
            image_url = extract_image_url(item)
            if not image_url or not image_url.startswith("data:"):
                continue
            files.append(write_data_url_image(image_url, directory, len(files)))
    return files


def extract_image_url(item: dict[str, Any]) -> str | None:
    raw = item.get("image_url")
    if isinstance(raw, str):
        return raw
    if isinstance(raw, dict):
        url = raw.get("url")
        return url if isinstance(url, str) else None
    return None


def write_data_url_image(data_url: str, directory: Path, index: int) -> Path:
    header, separator, encoded = data_url.partition(",")
    if separator != "," or not header.startswith("data:"):
        raise ValueError("Invalid image data URL")
    mime_type = header.removeprefix("data:").split(";", 1)[0].lower()
    suffix = {
        "image/jpeg": ".jpg",
        "image/jpg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp",
        "image/gif": ".gif",
    }.get(mime_type, ".png")
    path = directory / f"text-input-{index}{suffix}"
    path.write_bytes(base64.b64decode(encoded))
    return path


def build_responses_response(text: str, *, model: str) -> dict[str, Any]:
    created_at = int(time.time())
    return {
        "id": f"resp_{uuid.uuid4().hex}",
        "object": "response",
        "created_at": created_at,
        "model": model,
        "output_text": text,
        "output": [
            {
                "id": f"msg_{uuid.uuid4().hex}",
                "type": "message",
                "role": "assistant",
                "content": [{"type": "output_text", "text": text}],
            }
        ],
        "usage": {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0},
    }


def build_chat_completion_response(text: str, *, model: str) -> dict[str, Any]:
    return {
        "id": f"chatcmpl_{uuid.uuid4().hex}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": model,
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": text},
                "finish_reason": "stop",
            }
        ],
        "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
    }


def build_gemini_prompt(*, mode: str, prompt: str, size: str | None, has_mask: bool) -> str:
    size_instruction = f"\nTarget canvas size: {size}." if size else ""
    if mode == "edit":
        mask_instruction = (
            "\nA mask image is attached. Treat the mask as the edit region and preserve unmasked areas as much as possible."
            if has_mask
            else "\nUse the attached image as the source image and preserve its important identity, composition, and style unless the instruction says otherwise."
        )
        return (
            "Edit the attached image and return only the generated image output."
            f"{size_instruction}{mask_instruction}\n\nUser instruction:\n{prompt}"
        )
    return (
        "Generate a new image and return only the generated image output."
        f"{size_instruction}\n\nUser prompt:\n{prompt}"
    )


async def generated_image_to_b64_json(image: Any, directory: Path, filename: str) -> str:
    directory.mkdir(parents=True, exist_ok=True)
    saved_path = await image.save(path=str(directory), filename=filename, verbose=False)
    output_path = Path(saved_path) if saved_path else directory / filename
    if not output_path.exists():
        output_path = directory / filename
    return base64.b64encode(output_path.read_bytes()).decode("ascii")


class GeminiBridge:
    def __init__(
        self,
        *,
        secure_1psid: str | None,
        secure_1psidts: str | None,
        cookies: list[dict[str, Any]] | None,
        proxy: str | None,
        output_dir: Path,
        auth_file_stamp: AuthFileStamp | None = None,
        client_timeout: float | None = None,
    ) -> None:
        self.secure_1psid = secure_1psid
        self.secure_1psidts = secure_1psidts
        self.cookies = cookies or []
        self.proxy = proxy
        self.output_dir = output_dir
        self.auth_file_stamp = auth_file_stamp
        self.client_timeout = client_timeout or DEFAULT_CLIENT_TIMEOUT_SECONDS
        self._client: Any | None = None
        self._init_lock = asyncio.Lock()

    async def client(self) -> Any:
        async with self._init_lock:
            await self.reload_auth_if_changed()
            if self._client is not None:
                return self._client
            try:
                from gemini_webapi import GeminiClient
            except ImportError as error:
                raise RuntimeError(
                    "gemini_webapi is not installed. Run: python -m pip install -r scripts/requirements-gemini-bridge.txt"
                ) from error

            if self.secure_1psid:
                client = GeminiClient(self.secure_1psid, self.secure_1psidts or "", proxy=self.proxy)
            else:
                client = GeminiClient(proxy=self.proxy)
            if self.cookies:
                apply_cookie_auth(client, GeminiWebAuth(self.secure_1psid or "", self.secure_1psidts or "", self.cookies))
            await client.init(timeout=self.client_timeout, auto_close=True, close_delay=300, auto_refresh=True)
            self._client = client
            return client

    async def reload_auth_if_changed(self) -> None:
        if self.auth_file_stamp is None:
            return
        current_stamp = get_gemini_web_auth_file_stamp()
        if current_stamp == self.auth_file_stamp:
            return
        if self._client is not None:
            try:
                await self._client.close()
            finally:
                self._client = None
        auth = load_gemini_web_auth()
        self.secure_1psid = auth.secure_1psid
        self.secure_1psidts = auth.secure_1psidts
        self.cookies = auth.cookies
        self.auth_file_stamp = current_stamp

    async def reset_client(self, *, reload_auth: bool) -> None:
        if self._client is not None:
            try:
                await self._client.close()
            finally:
                self._client = None
        if reload_auth:
            auth = load_gemini_web_auth()
            self.secure_1psid = auth.secure_1psid
            self.secure_1psidts = auth.secure_1psidts
            self.cookies = auth.cookies
            self.auth_file_stamp = get_gemini_web_auth_file_stamp()

    async def run_with_auth_recovery(self, operation: Any) -> Any:
        try:
            return await operation()
        except Exception as error:
            if not is_recoverable_auth_error(error):
                raise
            await self.reset_client(reload_auth=True)
            return await operation()

    async def generate_images(
        self,
        *,
        prompt: str,
        count: int,
        mode: str,
        size: str | None,
        files: list[Path],
        has_mask: bool,
    ) -> list[str]:
        async def operation() -> list[str]:
            client = await self.client()
            gemini_prompt = build_gemini_prompt(mode=mode, prompt=prompt, size=size, has_mask=has_mask)
            encoded_images: list[str] = []

            while len(encoded_images) < count:
                response = await client.generate_content(
                    gemini_prompt,
                    files=[str(path) for path in files] if files else None,
                    temporary=True,
                )
                images = list(getattr(response, "images", None) or [])
                if not images:
                    response_text = getattr(response, "text", "") or "Gemini returned no generated images"
                    raise RuntimeError(response_text)
                for image in images:
                    if len(encoded_images) >= count:
                        break
                    filename = f"gemini-web-{uuid.uuid4().hex}.png"
                    encoded_images.append(await generated_image_to_b64_json(image, self.output_dir, filename))

            return encoded_images

        return await self.run_with_auth_recovery(operation)

    async def generate_text(self, *, prompt: str, files: list[Path] | None = None) -> str:
        async def operation() -> str:
            client = await self.client()
            response = await client.generate_content(
                prompt,
                files=[str(path) for path in files] if files else None,
                temporary=True,
            )
            text = str(getattr(response, "text", "") or "").strip()
            if not text:
                raise RuntimeError("Gemini returned empty text")
            return text

        return await self.run_with_auth_recovery(operation)


def is_recoverable_auth_error(error: Exception) -> bool:
    message = str(error).lower()
    return any(marker in message for marker in AUTH_RECOVERY_MESSAGES)


def create_app() -> Any:
    try:
        from fastapi import FastAPI
        from fastapi.responses import JSONResponse
    except ImportError as error:
        raise RuntimeError(
            "FastAPI is not installed. Run: python -m pip install -r scripts/requirements-gemini-bridge.txt"
        ) from error

    app = FastAPI(title="Gemini WebAPI OpenAI Images Bridge")
    api_key = os.getenv("GEMINI_BRIDGE_API_KEY", "").strip()
    output_dir = Path(os.getenv("GEMINI_BRIDGE_OUTPUT_DIR", tempfile.gettempdir())) / "gemini-webapi-openai-bridge"
    auth = load_gemini_web_auth()
    configure_gemini_cookie_path(auth)
    configure_safe_gemini_cookie_cache()
    bridge = GeminiBridge(
        secure_1psid=auth.secure_1psid,
        secure_1psidts=auth.secure_1psidts,
        cookies=auth.cookies,
        proxy=os.getenv("GEMINI_WEBAPI_PROXY") or None,
        output_dir=output_dir,
        auth_file_stamp=get_gemini_web_auth_file_stamp(),
        client_timeout=get_gemini_client_timeout_seconds(),
    )

    async def require_auth(request: Any) -> JSONResponse | None:
        if not api_key:
            return None
        authorization = request.headers.get("authorization", "")
        expected = f"Bearer {api_key}"
        if authorization != expected:
            return JSONResponse({"error": {"message": "Unauthorized", "type": "invalid_request_error"}}, status_code=401)
        return None

    async def json_error(message: str, status_code: int = 500) -> JSONResponse:
        return JSONResponse({"error": {"message": message, "type": "gemini_webapi_error"}}, status_code=status_code)

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/v1/models")
    async def models(request: Request) -> Any:
        auth_error = await require_auth(request)
        if auth_error:
            return auth_error
        return {"object": "list", "data": [{"id": DEFAULT_MODEL, "object": "model", "owned_by": "gemini-webapi"}]}

    @app.post("/v1/responses")
    async def responses(request: Request) -> Any:
        auth_error = await require_auth(request)
        if auth_error:
            return auth_error
        temp_dir = Path(tempfile.mkdtemp(prefix="gemini-web-text-"))
        try:
            payload = await request.json()
            text_input = extract_responses_input(payload, temp_dir)
            if not text_input.prompt:
                return await json_error("input is required", 400)
            model = str(payload.get("model") or DEFAULT_MODEL)
            text = await bridge.generate_text(prompt=text_input.prompt, files=text_input.files)
            return build_responses_response(text, model=model)
        except Exception as error:
            return await json_error(str(error))
        finally:
            cleanup_directory(temp_dir)

    @app.post("/v1/chat/completions")
    async def chat_completions(request: Request) -> Any:
        auth_error = await require_auth(request)
        if auth_error:
            return auth_error
        temp_dir = Path(tempfile.mkdtemp(prefix="gemini-web-text-"))
        try:
            payload = await request.json()
            text_input = extract_chat_messages_input(payload, temp_dir)
            if not text_input.prompt:
                return await json_error("messages are required", 400)
            model = str(payload.get("model") or DEFAULT_MODEL)
            text = await bridge.generate_text(prompt=text_input.prompt, files=text_input.files)
            return build_chat_completion_response(text, model=model)
        except Exception as error:
            return await json_error(str(error))
        finally:
            cleanup_directory(temp_dir)

    @app.post("/v1/images/generations")
    async def image_generations(request: Request) -> Any:
        auth_error = await require_auth(request)
        if auth_error:
            return auth_error
        try:
            payload = await request.json()
            prompt = str(payload.get("prompt") or "").strip()
            if not prompt:
                return await json_error("prompt is required", 400)
            count = max(1, min(int(payload.get("n") or 1), 4))
            size = payload.get("size")
            images = await bridge.generate_images(
                prompt=prompt,
                count=count,
                mode="generation",
                size=str(size) if size else None,
                files=[],
                has_mask=False,
            )
            return {"created": 0, "data": [{"b64_json": image} for image in images]}
        except Exception as error:
            return await json_error(str(error))

    @app.post("/v1/images/edits")
    async def image_edits(request: Request) -> Any:
        auth_error = await require_auth(request)
        if auth_error:
            return auth_error
        temp_dir = Path(tempfile.mkdtemp(prefix="gemini-web-edit-"))
        try:
            form = await request.form()
            prompt = str(form.get("prompt") or "").strip()
            if not prompt:
                return await json_error("prompt is required", 400)
            count = max(1, min(int(form.get("n") or 1), 4))
            size = form.get("size")
            upload_items = []
            upload_items.extend(form.getlist("image"))
            mask = form.get("mask")
            if mask is not None:
                upload_items.append(mask)

            files: list[Path] = []
            for index, upload in enumerate(upload_items):
                filename = getattr(upload, "filename", "") or f"image-{index}.png"
                suffix = Path(filename).suffix or ".png"
                file_path = temp_dir / f"input-{index}{suffix}"
                content = await upload.read()
                file_path.write_bytes(content)
                files.append(file_path)

            if not files:
                return await json_error("image is required", 400)

            images = await bridge.generate_images(
                prompt=prompt,
                count=count,
                mode="edit",
                size=str(size) if size else None,
                files=files,
                has_mask=mask is not None,
            )
            return {"created": 0, "data": [{"b64_json": image} for image in images]}
        except Exception as error:
            return await json_error(str(error))
        finally:
            cleanup_directory(temp_dir)

    return app


def cleanup_directory(directory: Path) -> None:
    if not directory.exists():
        return
    for path in directory.glob("*"):
        path.unlink(missing_ok=True)
    directory.rmdir()


def main() -> None:
    parser = argparse.ArgumentParser(description="Run a local OpenAI Images API bridge backed by gemini_webapi.")
    parser.add_argument("--host", default=os.getenv("GEMINI_BRIDGE_HOST", DEFAULT_HOST))
    parser.add_argument("--port", default=int(os.getenv("GEMINI_BRIDGE_PORT", str(DEFAULT_PORT))), type=int)
    args = parser.parse_args()

    try:
        import uvicorn
    except ImportError as error:
        raise RuntimeError(
            "uvicorn is not installed. Run: python -m pip install -r scripts/requirements-gemini-bridge.txt"
        ) from error

    uvicorn.run(create_app(), host=args.host, port=args.port)


if __name__ == "__main__":
    main()
