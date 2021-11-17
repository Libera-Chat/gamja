import { html, render } from "./lib/index.js";
import App from "./components/app.js";

render(html`<${App}/>`, document.body);
