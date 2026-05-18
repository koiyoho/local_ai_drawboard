export function LoadingState({ message = "正在加载..." }: { message?: string }) {
  return <main className="login-shell"><p className="muted">{message}</p></main>;
}

export function ErrorState({ message }: { message: string }) {
  return <main className="login-shell"><p className="auth-error">{message}</p></main>;
}
