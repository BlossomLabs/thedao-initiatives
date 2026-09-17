import { Dialog } from "~/components/ui/Dialog";
import { Button } from "~/components/ui/Button";

export type DraftLogoutChoice = "keep" | "delete" | "cancel";

export default function DraftLogoutDialog({ open, onChoose }: {
  open: boolean;
  onChoose: (choice: DraftLogoutChoice) => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) onChoose("cancel");
      }}
      title="Keep your unfinished draft?"
      description="Your draft is saved for this wallet in this browser. Keep it to continue when you sign back in, or delete it before logging out."
    >
      <div className="mt-2 flex flex-col gap-2">
        <Button variant="primary" onClick={() => onChoose("keep")}>Keep draft and log out</Button>
        <Button variant="danger" onClick={() => onChoose("delete")}>
          Delete draft and log out
        </Button>
        <Button variant="ghost" onClick={() => onChoose("cancel")}>Cancel</Button>
      </div>
    </Dialog>
  );
}
