import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import "@xterm/xterm/css/xterm.css";

createRoot(document.getElementById("root")!).render(<App />);
