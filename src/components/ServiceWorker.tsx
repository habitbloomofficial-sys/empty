"use client";

import { useEffect } from "react";

/**
 * Registers the service worker, which is what makes the browser offer to
 * install Axis as an app.
 *
 * Only in production: in development the worker would sit between you and
 * every page you are editing, and the confusion it causes is out of all
 * proportion to what it does.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    // Registration failing is not worth telling anyone about — it costs the
    // install prompt and nothing else.
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);

  return null;
}
