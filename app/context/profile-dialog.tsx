/**
 * One shared "name and picture" dialog for the whole app, so the top-bar
 * sign-in prompt and page-level gates (the submit form) never stack two.
 */
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import NicknameDialog from "~/components/wallet/NicknameDialog";
import { useSiteSettings } from "~/hooks/use-site-settings";

interface ProfileDialogCtx {
  profileOpen: boolean;
  /** `firstTime` = onboarding copy and a "Skip for now" button. */
  openProfile(firstTime?: boolean): void;
}

const Ctx = createContext<ProfileDialogCtx | null>(null);

export function ProfileDialogProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [firstTime, setFirstTime] = useState(false);
  const settings = useSiteSettings();
  const openProfile = useCallback((first = false) => {
    setFirstTime(first);
    setOpen(true);
  }, []);
  const value = useMemo(() => ({ profileOpen: open, openProfile }), [open, openProfile]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <NicknameDialog
        open={open}
        onOpenChange={setOpen}
        firstTime={firstTime}
        uploadsEnabled={settings.data?.uploads}
      />
    </Ctx.Provider>
  );
}

export function useProfileDialog(): ProfileDialogCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useProfileDialog outside ProfileDialogProvider");
  return v;
}
