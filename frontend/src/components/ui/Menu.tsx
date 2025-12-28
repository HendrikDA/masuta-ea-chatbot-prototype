import React, { use, useState } from "react";
import {
  Button,
  Menu,
  Portal,
  Clipboard,
  Dialog,
  IconButton,
  CloseButton,
  FileUpload,
  Icon,
  Box,
  Spinner,
  Link,
  Text,
  Center,
} from "@chakra-ui/react";
import { FaTrashAlt } from "react-icons/fa";
import { FiUpload } from "react-icons/fi";
import { IoMdMenu } from "react-icons/io";
import { FaExternalLinkAlt } from "react-icons/fa";
import { LuUpload } from "react-icons/lu";
import { colors } from "../../utils/colors";

interface CustomMenuProps {
  speedParcelIsActive: boolean;
}

export const CustomMenu: React.FC<CustomMenuProps> = ({
  speedParcelIsActive,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [connectionStringMenuOpen, setConnectionStringMenuOpen] =
    useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isLoading, setIsLoading] = useState(false);

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

  async function handleReset() {
    try {
      setIsLoading(true);
      await resetPlaygroundDatabase();

      setResetOpen(false);
      window.location.reload();
      alert("Playground database reset successfully");
    } catch (e) {
      console.error(e);
      alert("Reset failed");
    } finally {
      setIsLoading(false);
    }
  }

  const openResetDialog = () => {
    if (speedParcelIsActive) return;
    setMenuOpen(false);
    setResetOpen(true);
  };

  const openImportDialog = () => {
    setMenuOpen(false);
    setImportOpen(true);
  };

  const uploadFilesToBackend = async (files: File[]) => {
    console.log("Uploading files:", files);
    if (!files || files.length === 0)
      throw new Error("No files selected for upload");

    const formData = new FormData();

    for (const file of files) {
      formData.append("files", file, file.name);
    }

    console.log("Sending this form data: ", formData);

    const response = await fetch("http://localhost:4000/api/admin/add-data", {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(text || `Upload failed (${response.status})`);
    }

    // if your backend returns JSON:
    const data = await response.json().catch(() => null);
    return data;
  };

  const handleXmlImport = async () => {
    try {
      setIsUploading(true);
      const result = await uploadFilesToBackend(selectedFiles);
      console.log("Import result:", result);
      window.location.reload();
      alert("Import successful");
    } catch (e) {
      console.error(e);
      alert(e instanceof Error ? e.message : "Import failed");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <>
      {isLoading ||
        (isUploading && (
          <Portal>
            <Box
              position="fixed"
              inset={0}
              aria-busy="true"
              userSelect="none"
              bg="bg/80"
              zIndex="toast" // higher than modal/dialog
            >
              <Center h="full">
                <Spinner size="xl" color={colors.purple} />
                <Text paddingLeft="2rem">Loading...</Text>
              </Center>
            </Box>
          </Portal>
        ))}
      {/* ===== MENU ===== */}
      <Menu.Root open={menuOpen} onOpenChange={(e) => setMenuOpen(e.open)}>
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
              <Menu.Item
                value="reset_db"
                disabled={speedParcelIsActive}
                onClick={openResetDialog}
              >
                <FaTrashAlt style={{ marginRight: "0.5rem" }} />
                Reset Playground Database
                {speedParcelIsActive ? " (must have it selected)" : ""}
              </Menu.Item>

              <Menu.Item
                value="import_data"
                onClick={openImportDialog}
                disabled={speedParcelIsActive}
              >
                <FiUpload style={{ marginRight: "0.5rem" }} />
                Import data from file{" "}
                {speedParcelIsActive ? " (must have playground selected)" : ""}
              </Menu.Item>
              <Menu.Item
                value="show_neo4j_browser"
                onClick={() => {
                  setConnectionStringMenuOpen(true);
                }}
              >
                <Link
                  target="_blank"
                  href="https://console-preview.neo4j.io/tools/query"
                  _focus={{ boxShadow: "none" }}
                  outline="none"
                  border="none"
                >
                  <FaExternalLinkAlt style={{ marginRight: "0.5rem" }} />
                  View graph data in neo4j Browser
                </Link>
              </Menu.Item>
            </Menu.Content>
          </Menu.Positioner>
        </Portal>
      </Menu.Root>

      {/* ===== DIALOG: CLEAR DATABASE ===== */}
      <Dialog.Root open={resetOpen} onOpenChange={(e) => setResetOpen(e.open)}>
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
      </Dialog.Root>

      {/* ===== DIALOG: FILE UPLOAD ===== */}
      <Dialog.Root
        open={importOpen}
        onOpenChange={(e) => setImportOpen(e.open)}
      >
        <Portal>
          <Dialog.Backdrop />
          <Dialog.Positioner>
            <Dialog.Content backgroundColor={colors.cream}>
              <Dialog.Header>
                <Dialog.Title>Import data</Dialog.Title>
              </Dialog.Header>

              <Dialog.Body>
                <FileUpload.Root
                  maxW="xl"
                  alignItems="stretch"
                  maxFiles={10}
                  accept=".xml"
                  onFileChange={(details) => {
                    console.log("Selected files:", details);
                    setSelectedFiles(details.acceptedFiles ?? []);
                  }}
                >
                  <FileUpload.HiddenInput />
                  <FileUpload.Dropzone>
                    <Icon size="md" color="fg.muted">
                      <LuUpload />
                    </Icon>
                    <FileUpload.DropzoneContent>
                      <Box>Drag and drop files here</Box>
                      <Box color="fg.muted">Supported: .xml</Box>
                    </FileUpload.DropzoneContent>
                  </FileUpload.Dropzone>
                  <FileUpload.List />
                </FileUpload.Root>
                {/* optional: show count */}
                <Box mt="3" fontSize="sm" color="fg.muted">
                  {selectedFiles.length
                    ? `${selectedFiles.length} file(s) selected`
                    : "No files selected"}
                </Box>
              </Dialog.Body>

              <Dialog.Footer>
                <Button
                  onClick={() => handleXmlImport()}
                  isLoading={isUploading}
                  disabled={isUploading}
                >
                  Import
                </Button>
              </Dialog.Footer>

              <Dialog.CloseTrigger asChild>
                <CloseButton size="sm" />
              </Dialog.CloseTrigger>
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>

      {/* ===== DIALOG: Show Connection String for Database ===== */}
      <Dialog.Root
        open={connectionStringMenuOpen}
        onOpenChange={(e) => setConnectionStringMenuOpen(e.open)}
      >
        <Portal>
          <Dialog.Backdrop />
          <Dialog.Positioner>
            <Dialog.Content backgroundColor={colors.cream}>
              <Dialog.Header>
                <Dialog.Title>
                  Connect to{" "}
                  {speedParcelIsActive ? "SpeedParcel" : "Playground"} Database
                  with this information
                </Dialog.Title>
              </Dialog.Header>

              <Dialog.Body>
                <p>
                  <b>URL: </b>
                  {speedParcelIsActive
                    ? process.env.REACT_APP_LOCAL_SPEEDPARCEL_NEO4J_URI
                    : process.env.REACT_APP_LOCAL_PLAYGROUND_NEO4J_URI}{" "}
                  <Clipboard.Root
                    display="inline"
                    marginLeft="0.5rem"
                    value={
                      speedParcelIsActive
                        ? process.env.REACT_APP_LOCAL_SPEEDPARCEL_NEO4J_URI
                        : process.env.REACT_APP_LOCAL_PLAYGROUND_NEO4J_URI
                    }
                  >
                    <Clipboard.Trigger asChild>
                      <Link as="span" color="blue.fg" textStyle="sm">
                        <Clipboard.Indicator />
                      </Link>
                    </Clipboard.Trigger>
                  </Clipboard.Root>
                </p>
                <p>
                  <b>Username:</b> neo4j
                </p>
                <p>
                  <b>Password:</b> password
                </p>
              </Dialog.Body>
              <Dialog.CloseTrigger asChild>
                <CloseButton size="sm" />
              </Dialog.CloseTrigger>
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>
    </>
  );
};
