import type { Metadata } from "next";
import Link from "next/link";
import { AuthForm } from "@/app/_components/auth-form";

export const metadata: Metadata = { title: "Sign up — Granted" };

export default function SignupPage() {
  return (
    <section className="mx-auto max-w-sm py-6">
      <div className="paper tape-card p-6 sm:p-7">
        <h1 className="text-2xl font-semibold tracking-tight">Create your free account</h1>
        <p className="mt-1 mb-6 text-sm text-[var(--color-muted)]">
          Get 10 free searches. Upgrade any time to the 30-Day Job Hunt Pass for 500 searches and
          live web search.
        </p>
        <AuthForm mode="signup" />
      </div>
      <p className="mt-4 text-center text-sm text-[var(--color-muted)]">
        Already have an account?{" "}
        <Link href="/login" className="font-semibold text-[var(--color-ink)] underline">
          Log in
        </Link>
      </p>
    </section>
  );
}
