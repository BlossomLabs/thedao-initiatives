/**
 * One shared "name and picture" dialog for the whole app, so the top-bar
 * sign-in prompt and page-level gates (the submit form) never stack two.
 */
import {
  createContext,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { afterLoad } from "~/lib/after-load";
import { useSiteSettings } from "~/hooks/use-site-settings";

// Not in the first load: fetched once the page is idle, or when first opened.
let dialog: Promise<typeof import("~/components/wallet/NicknameDialog")> | null = null;
const loadDialog = () =>
  dialog ??= import("~/components/wallet/NicknameDialog").catch((e) => {
    dialog = null;
    throw e;
  });
const NicknameDialog = lazy(loadDialog);

interface ProfileDialogCtx {
  profileOpen: boolean;
  /** `firstTime` = onboarding copy and a "Skip for now" button. */
  openProfile(firstTime?: boolean): void;
}

const Ctx = createContext<ProfileDialogCtx | null>(null);

export function ProfileDialogProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  // Mounted from the first open on, so closing still animates out.
  const [opened, setOpened] = useState(false);
  const [firstTime, setFirstTime] = useState(false);
  const settings = useSiteSettings();
  useEffect(() => afterLoad(() => void loadDialog().catch(() => {})), []);
  const openProfile = useCallback((first = false) => {
    setFirstTime(first);
    setOpened(true);
    setOpen(true);
  }, []);
  const value = useMemo(() => ({ profileOpen: open, openProfile }), [open, openProfile]);
  return (
    <Ctx.Provider value={value}>
      {children}
      {opened && (
        <Suspense fallback={null}>
          <NicknameDialog
            open={open}
            onOpenChange={setOpen}
            firstTime={firstTime}
            uploadsEnabled={settings.data?.uploads}
          />
        </Suspense>
      )}
    </Ctx.Provider>
  );
}

export function useProfileDialog(): ProfileDialogCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useProfileDialog outside ProfileDialogProvider");
  return v;
}
