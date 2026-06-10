"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AuthForm } from "./auth-form";
import { BuyPassButton } from "./buy-pass-button";

// One modal that adapts to WHY the user was blocked (the gate's `code`):
//   signup       → inline sign-up (anon hit the wall)
//   upgrade / pass_expired → pitch + buy the Job Hunt Pass
//   verify_email → "check your inbox"
export function PaywallModal({
  open,
  code,
  message,
  onClose,
}: {
  open: boolean;
  code: string | null;
  message: string;
  onClose: () => void;
}) {
  const router = useRouter();
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {code === "signup" ? (
          <>
            <h2 className="text-lg font-semibold">Create a free account to keep searching</h2>
            <p className="mt-1 mb-4 text-sm text-[var(--color-muted)]">{message}</p>
            <AuthForm
              mode="signup"
              onSuccess={() => {
                onClose();
                router.refresh();
              }}
            />
            <p className="mt-3 text-xs text-[var(--color-muted)]">
              Already have an account?{" "}
              <Link href="/login" className="underline">Log in</Link>
            </p>
          </>
        ) : code === "upgrade" || code === "pass_expired" ? (
          <>
            <h2 className="text-lg font-semibold">Get the 30-Day Job Hunt Pass</h2>
            <p className="mt-1 mb-3 text-sm text-[var(--color-muted)]">{message}</p>
            <ul className="mb-4 grid gap-1.5 text-sm">
              <li className="flex items-center gap-2"><span className="text-emerald-600">✓</span> 500 searches</li>
              <li className="flex items-center gap-2"><span className="text-emerald-600">✓</span> Live web search for funded companies</li>
              <li className="flex items-center gap-2"><span className="text-emerald-600">✓</span> 30 days · no auto-renew</li>
            </ul>
            <BuyPassButton />
          </>
        ) : code === "verify_email" ? (
          <>
            <h2 className="text-lg font-semibold">Verify your email</h2>
            <p className="mt-1 text-sm text-[var(--color-muted)]">{message}</p>
          </>
        ) : (
          <p className="text-sm text-[var(--color-ink)]">{message}</p>
        )}

        <button onClick={onClose} className="mt-4 text-xs text-[var(--color-muted)] underline">
          Close
        </button>
      </div>
    </div>
  );
}
