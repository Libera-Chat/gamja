export * from "/node_modules/preact/dist/preact.module.js";

import { h } from "/node_modules/preact/dist/preact.module.js";
import htm from "/node_modules/htm/dist/htm.module.js";
export const html = htm.bind(h);

import "/node_modules/anchorme/dist/browser/anchorme.min.js";
export const anchorme = window.anchorme;
