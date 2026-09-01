// The sliver of `qrcode` that Axis actually uses.
//
// The package ships no types of its own. Depending on @types/qrcode for this
// works, but it is a devDependency that exists solely to describe one function
// — and it has a cost that is easy to miss: after an update adds it, a build
// run before `npm install` fails with "Failed to type check" and no obvious
// cause, because the runtime package was already there and only the
// declarations were missing.
//
// One call, one declaration, no dependency. If more of the library is ever
// needed, the honest move is to add the real types back rather than to grow
// this file into a guess at someone else's API.

declare module "qrcode" {
  export interface QRCodeToStringOptions {
    /** Only the SVG renderer is used here. */
    type?: "svg" | "utf8" | "terminal";
    /** Quiet zone, in modules. */
    margin?: number;
    /** Pixel width of the rendered square. */
    width?: number;
    /** How much of the code can be lost and still scan. */
    errorCorrectionLevel?: "L" | "M" | "Q" | "H";
    color?: { dark?: string; light?: string };
  }

  export function toString(text: string, options?: QRCodeToStringOptions): Promise<string>;

  const QRCode: { toString: typeof toString };
  export default QRCode;
}
