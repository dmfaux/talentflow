"use client";

import { useState, useEffect, useCallback } from "react";
import { ChatAuth } from "./ChatAuth";
import { ChatInterface } from "./ChatInterface";

interface BrandColours {
  primary: string;
  secondary: string;
  accent: string | null;
  text: string;
}

interface Props {
  clientSlug: string;
  campaignSlug: string;
  roleTitle: string;
  roleDescriptionHtml: string;
  companyName: string;
  location: string | null;
  employmentType: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  logoUrl: string | null;
  brandColours: BrandColours;
}

export function ChatPageClient({
  clientSlug,
  campaignSlug,
  roleTitle,
  companyName,
  roleDescriptionHtml,
  location,
  employmentType,
  salaryMin,
  salaryMax,
  logoUrl,
  brandColours,
}: Props) {
  const storageKey = `ts_chat_${clientSlug}_${campaignSlug}`;
  const [chatToken, setChatToken] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check URL fragment for magic link token
    const hash = window.location.hash;
    if (hash.startsWith("#chat_token=")) {
      const token = hash.slice("#chat_token=".length);
      try {
        localStorage.setItem(storageKey, token);
      } catch {}
      setChatToken(token);
      // Clean the hash from the URL
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    } else {
      // Check localStorage
      try {
        const stored = localStorage.getItem(storageKey);
        setChatToken(stored);
      } catch {}
    }

    // Get conversation ID from query param
    const searchParams = new URLSearchParams(window.location.search);
    setConversationId(searchParams.get("t"));

    setLoading(false);
  }, [storageKey]);

  const handleAuthSuccess = useCallback(
    (token: string) => {
      try {
        localStorage.setItem(storageKey, token);
      } catch {}
      setChatToken(token);
    },
    [storageKey]
  );

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f5f4f0]">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#e8e8e4] border-t-[#11123c]" />
      </div>
    );
  }

  if (!chatToken) {
    return (
      <ChatAuth
        clientSlug={clientSlug}
        campaignSlug={campaignSlug}
        roleTitle={roleTitle}
        companyName={companyName}
        logoUrl={logoUrl}
        brandColours={brandColours}
        onSuccess={handleAuthSuccess}
      />
    );
  }

  return (
    <ChatInterface
      conversationId={conversationId}
      chatToken={chatToken}
      roleTitle={roleTitle}
      roleDescriptionHtml={roleDescriptionHtml}
      companyName={companyName}
      location={location}
      employmentType={employmentType}
      salaryMin={salaryMin}
      salaryMax={salaryMax}
      logoUrl={logoUrl}
      brandColours={brandColours}
    />
  );
}
