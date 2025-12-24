import React from "react";
import { Button, Menu, Portal, Dialog, CloseButton } from "@chakra-ui/react";
import { FaTrashAlt } from "react-icons/fa";
import { IoMdMenu } from "react-icons/io";
import { colors } from "../../utils/colors";

interface CustomMenuProps {
  speedParcelIsActive: boolean;
}

export const CustomMenu: React.FC<CustomMenuProps> = ({
  speedParcelIsActive,
}) => {
  async function handleReset() {
    try {
      await resetPlaygroundDatabase();
      window.location.reload();
    } catch (e) {
      console.error(e);
      alert("Reset failed");
    } finally {
      alert("Database reset successfully");
    }
  }

  async function resetPlaygroundDatabase(): Promise<void> {
    const response = await fetch(
      "http://localhost:4000/api/admin/reset-graph",
      {
        method: "POST",
      }
    );

    if (!response.ok) {
      throw new Error("Failed to reset database");
    }
  }

  return (
    <Dialog.Root>
      {/* ===== MENU ===== */}
      <Menu.Root style={{ float: "left", marginLeft: "1rem" }}>
        <Menu.Trigger asChild>
          <Button variant="solid" size="md" backgroundColor={colors.purple}>
            <IoMdMenu />
          </Button>
        </Menu.Trigger>

        <Portal>
          <Menu.Positioner>
            <Menu.Content
              backgroundColor={colors.cream}
              maxH="200px"
              minW="14rem"
            >
              {/* Menu item triggers the dialog */}
              <Dialog.Trigger asChild disabled={speedParcelIsActive}>
                <Menu.Item value="reset_db" disabled={speedParcelIsActive}>
                  <FaTrashAlt style={{ marginRight: "0.5rem" }} />
                  Reset Playground Database{" "}
                  {speedParcelIsActive ? "(must have it selected)" : ""}
                </Menu.Item>
              </Dialog.Trigger>
            </Menu.Content>
          </Menu.Positioner>
        </Portal>
      </Menu.Root>

      {/* ===== DIALOG ===== */}
      {!speedParcelIsActive ? (
        <Portal>
          <Dialog.Backdrop />
          <Dialog.Positioner>
            <Dialog.Content backgroundColor={colors.cream}>
              <Dialog.Header>
                <Dialog.Title>Reset Playground Database</Dialog.Title>
              </Dialog.Header>

              <Dialog.Body>
                <p>
                  Are you sure you want to reset the playground database?
                  <br />
                  This action <strong>cannot be undone</strong>.
                </p>
              </Dialog.Body>

              <Dialog.Footer>
                <Dialog.ActionTrigger asChild>
                  <Button variant="outline">Cancel</Button>
                </Dialog.ActionTrigger>
                <Button colorPalette="red" onClick={handleReset}>
                  Reset
                </Button>
              </Dialog.Footer>

              <Dialog.CloseTrigger asChild>
                <CloseButton size="sm" />
              </Dialog.CloseTrigger>
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      ) : null}
    </Dialog.Root>
  );
};
