import type { Metadata } from "next";
import { Suspense } from "react";
import "./globals.css";
import { Sidebar, SidebarFrame } from "@/components/sidebar";
import { LangEffect } from "@/components/i18n";

export const metadata: Metadata = {
  title: "የሳኮ መረጃ ማስገቢያ · SACCO Data Import",
  description: "ማንኛውንም የአባላት፣ የቁጠባ ወይም የብድር ኤክሴል ፋይል የሳኮ ሲስተሙ ወደሚጠብቀው ቴምፕሌት ይቀይራል።",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="am" className="h-full antialiased">
      <body className="min-h-full">
        <LangEffect />
        <div className="flex min-h-screen flex-col lg:flex-row">
          <Suspense fallback={<SidebarFrame pathname={null} />}>
            <Sidebar />
          </Suspense>
          <main className="min-w-0 flex-1">
            <div className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</div>
          </main>
        </div>
      </body>
    </html>
  );
}
