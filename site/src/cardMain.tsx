import { createRoot } from "react-dom/client";
import { Card } from "./Card";
import raw from "./generated/data.json";
import type { GintiData } from "./types";
import "./styles.css";
import "./card.css";

// No StrictMode: this renders once, into a screenshot. A double mount would
// only give the generator two chances to catch a half-painted frame.
createRoot(document.getElementById("card")!).render(
  <Card data={raw as unknown as GintiData} />,
);
