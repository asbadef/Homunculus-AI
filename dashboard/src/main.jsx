import React from "react";
import { createRoot } from "react-dom/client";
import { Board } from "./Board.jsx";

createRoot(document.getElementById("root")).render(<Board token="dev-token" />);
