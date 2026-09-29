import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { setBaseUrl } from "@workspace/api-client-react";

// API requests stay same-origin so the Webmail server can enforce SSO
// and attach its server-only credential when proxying to the API service.
setBaseUrl(null);

createRoot(document.getElementById("root")!).render(<App />);
