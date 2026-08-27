import "./zodConfig";
import "@fontsource-variable/inter/wght.css";
import "@fontsource-variable/inter/wght-italic.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { FramingGuard } from "./components/FramingGuard";
import "./styles/global.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("REPLAY could not find its application root.");
}

createRoot(root).render(
  <StrictMode>{window.self === window.top ? <App /> : <FramingGuard />}</StrictMode>,
);
