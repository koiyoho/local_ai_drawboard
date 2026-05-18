import { AppIcon } from "@/components/ui/AppIcon";
import {
  IconApiKey,
  IconBoards,
  IconBrush,
  IconImage,
  IconImageFile,
  IconLogin,
  IconPen,
  IconPointer,
  IconRegister,
  IconUser,
} from "@/components/ui/icons";
import { FormEvent, useState, useTransition } from "react";

const errorMessages: Record<string, string> = {
  CredentialsSignin: "用户名或密码不正确",
  invalid: "用户名或密码不正确",
  invalid_registration: "用户名和密码不能为空，且不能超过长度限制",
  pending: "账号已提交注册，等待管理员审核通过后才能登录",
  rejected: "账号注册未通过，请联系管理员",
  username_exists: "该用户名已存在，请直接登录或更换用户名",
};

export function LoginPanel({
  error,
  mode = "login",
  onLogin,
  onRegister,
  registered,
}: {
  error?: string;
  mode?: "login" | "register";
  onLogin: (username: string, password: string) => Promise<void>;
  onRegister: (username: string, password: string) => Promise<void>;
  registered?: string;
}) {
  const [formError, setFormError] = useState("");
  const [isPending, startTransition] = useTransition();
  const errorMessage = formError || (error ? errorMessages[error] ?? "登录失败，请重试" : "");
  const isRegisterMode = mode === "register";

  function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const username = String(formData.get("username") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    startTransition(async () => {
      setFormError("");
      try {
        if (isRegisterMode) await onRegister(username, password);
        else await onLogin(username, password);
      } catch (error) {
        const message = error instanceof Error ? error.message : "提交失败";
        setFormError(errorMessages[message] ?? message);
      }
    });
  }

  return (
    <main className="login-shell">
      <section className="login-panel">
        <section className="login-pane">
          <div className="login-brand">
            <span className="login-brand-mark">AI</span>
            <strong>AI Board</strong>
          </div>

          <div className="login-auth-block">
            <h1>{isRegisterMode ? "创建画板账号" : "登录后进入画板"}</h1>

            <div className="login-mode-tabs" aria-label="登录方式">
              <a aria-current={isRegisterMode ? undefined : "true"} href="/login">
                登录
              </a>
              <a aria-current={isRegisterMode ? "true" : undefined} href="/login?mode=register">
                注册
              </a>
            </div>

            {registered ? <p className="auth-success">注册已提交，等待审核。</p> : null}
            {errorMessage ? <p className="auth-error">{errorMessage}</p> : null}

            {isRegisterMode ? (
              <form onSubmit={submitForm} className="login-form">
                <label className="auth-field">
                  用户名
                  <span className="auth-input-row">
                    <AppIcon icon={IconUser} size="lg" />
                    <input autoComplete="username" maxLength={40} name="username" required />
                  </span>
                </label>
                <label className="auth-field">
                  密码
                  <span className="auth-input-row">
                    <AppIcon icon={IconApiKey} size="lg" />
                    <input
                      autoComplete="new-password"
                      maxLength={128}
                      name="password"
                      required
                      type="password"
                    />
                  </span>
                </label>
                <button className="secondary-action" disabled={isPending} type="submit">
                  <AppIcon icon={IconRegister} size="lg" />
                  提交注册
                </button>
              </form>
            ) : (
              <form onSubmit={submitForm} className="login-form">
                <label className="auth-field">
                  用户名
                  <span className="auth-input-row">
                    <AppIcon icon={IconUser} size="lg" />
                    <input autoComplete="username" maxLength={40} name="username" required />
                  </span>
                </label>
                <label className="auth-field">
                  密码
                  <span className="auth-input-row">
                    <AppIcon icon={IconApiKey} size="lg" />
                    <input
                      autoComplete="current-password"
                      maxLength={128}
                      name="password"
                      required
                      type="password"
                    />
                  </span>
                </label>
                <button disabled={isPending} type="submit">
                  <AppIcon icon={IconLogin} size="lg" />
                  登录
                </button>
              </form>
            )}
          </div>

          <div className="login-tags" aria-label="登录规则">
            <span>本地存储</span>
            <span>注册审核</span>
          </div>
        </section>

        <section className="login-visual" aria-hidden="true">
          <div className="login-workspace-preview">
            <div className="login-workspace-top">
              <div className="login-brand">
                <span className="login-brand-mark">AI</span>
                <strong>图片工作台</strong>
              </div>
              <div className="login-preview-nav">
                <span>画板</span>
                <span>AI 生图</span>
                <span>AI 改图</span>
                <span>素材</span>
              </div>
            </div>

            <div className="login-canvas-preview">
              <div className="login-tool-strip">
                <span>
                  <AppIcon icon={IconPointer} size="lg" />
                </span>
                <span>
                  <AppIcon icon={IconBrush} size="lg" />
                </span>
                <span className="is-active">
                  <AppIcon icon={IconPen} size="lg" />
                </span>
                <span>
                  <AppIcon icon={IconImage} size="lg" />
                </span>
                <span>
                  <AppIcon icon={IconBoards} size="lg" />
                </span>
              </div>
              <div className="login-selected-image">
                <div className="login-image-popover">
                  <AppIcon icon={IconImage} size="md" />
                  <AppIcon icon={IconBoards} size="md" />
                  <AppIcon icon={IconImageFile} size="md" />
                </div>
              </div>
              <div className="login-side-preview">
                <div>
                  <strong />
                  <span />
                  <span />
                </div>
                <div>
                  <strong />
                  <span />
                  <span />
                </div>
              </div>
            </div>

            <div className="login-thumb-row">
              <span />
              <span />
              <span />
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}
