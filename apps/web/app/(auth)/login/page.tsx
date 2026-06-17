import type { Metadata } from "next";
import Link from "next/link";
import { AuthForm } from "@/app/_components/auth-form";

export const metadata: Metadata = { title: "Log in — Granted" };

export default function LoginPage() {
  return (
    <section className="mx-auto max-w-sm py-6">
      <div className="paper p-6 sm:p-7">
        <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
        <p className="mt-1 mb-6 text-sm text-[var(--color-muted)]">
          Log in to keep searching and to use your Job Hunt Pass.
        </p>
        <AuthForm mode="login" />
      </div>
      <p className="mt-4 text-center text-sm text-[var(--color-muted)]">
        New here?{" "}
        <Link href="/signup" className="font-semibold text-[var(--color-ink)] underline">
          Create a free account
        </Link>
      </p>
    </section>
  );
}
