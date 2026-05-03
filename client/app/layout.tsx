// app/layout.tsx
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import toast, { Toaster } from "react-hot-toast";
import Providers from "./providers";


const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
    title: "OmniMind",
    description: "OmniMind AI Platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    
    return (
        <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased hide-scrollbar`}>
            <body className="fixed inset-0 flex flex-col hide-scrollbar">
                <Providers>
                    <Toaster position="top-right" />
                    {children}
                </Providers>
            </body>
        </html>
    );
}