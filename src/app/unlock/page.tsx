import { UnlockScreen } from "@/components/UnlockScreen";

export const dynamic = "force-dynamic";

export default async function UnlockPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  return <UnlockScreen noPasscode={reason === "no-passcode"} />;
}
