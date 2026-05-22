import { createRoot } from "react-dom/client";
import "@/app/globals.css";

import { AdminApp } from "./pages/AdminApp";
import { BoardApp } from "./pages/BoardApp";
import { HomeApp } from "./pages/HomeApp";
import { LoginApp } from "./pages/LoginApp";
import { ReversePromptApp } from "./pages/ReversePromptApp";
import { getClientRoute } from "./routing";

function App() {
  const route = getClientRoute(window.location);
  if (route.kind === "login") return <LoginApp />;
  if (route.kind === "reversePrompt") return <ReversePromptApp />;
  if (route.kind === "admin") return <AdminApp />;
  if (route.kind === "board") return <BoardApp boardId={route.boardId} />;
  return <HomeApp />;
}

createRoot(document.getElementById("root")!).render(<App />);
