import type { Metadata } from "next";
import "./shop.css";
import { BRAND } from "@/lib/shop/brand";

export const metadata: Metadata = {
  title: `${BRAND.name} — ${BRAND.kicker}`,
  description: `${BRAND.full}. Wholesale supply for resellers, by invitation.`,
  // A trade catalogue with trade prices in it has no business in a search index.
  robots: { index: false, follow: false },
};

export default function ShopLayout({ children }: { children: React.ReactNode }) {
  return children;
}
