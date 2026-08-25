"use client";

import { useCallback, useState } from "react";
import { AccessGate } from "./AccessGate";
import { ArtDefs } from "./ArtDefs";
import { Intro } from "./Intro";
import { Shop } from "./Shop";

/*
 * Three rooms, one door between each.
 *
 * Gate, then introduction, then shop. The gate only appears to somebody without
 * a valid session; the introduction only plays the first time, and after that
 * only when asked for by name from the header. A buyer coming back for their
 * fourth order lands straight in the catalogue, which is the whole reason the
 * "seen it" flag is worth storing at all.
 */

type Stage = "gate" | "intro" | "shop";

export function ShopExperience({
  signedIn,
  introSeen,
}: {
  signedIn: boolean;
  introSeen: boolean;
}) {
  const [stage, setStage] = useState<Stage>(
    signedIn ? (introSeen ? "shop" : "intro") : "gate"
  );

  const finishIntro = useCallback(() => {
    setStage("shop");
    // Best effort: if this doesn't land, the worst case is the film plays once
    // more. Not worth blocking the shop on.
    void fetch("/api/shop/prefs", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ introSeen: true }),
    }).catch(() => {});
  }, []);

  const dark = stage !== "shop";

  return (
    <div className={`au-root${dark ? " au-dark" : ""}`}>
      <ArtDefs />
      {stage === "gate" && <AccessGate onOpen={() => setStage("intro")} />}
      {stage === "intro" && <Intro onEnter={finishIntro} />}
      {stage === "shop" && <Shop onReplayIntro={() => setStage("intro")} />}
    </div>
  );
}
