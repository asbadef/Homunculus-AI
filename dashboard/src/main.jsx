import "@fontsource-variable/figtree";
import "./index.css";
import React from "react";
import { createRoot } from "react-dom/client";
import { Board } from "./Board.jsx";
import { DemoApp } from "./demo.jsx";

const params = new URLSearchParams(window.location.search);
const isDemo = params.get("demo") === "1" || window.location.hash.startsWith("#/demo");

createRoot(document.getElementById("root")).render(
  isDemo
    ? <DemoApp scenario={params.get("scenario") || "septic_shock"} />
    : <Board token="dev-token" />
);
