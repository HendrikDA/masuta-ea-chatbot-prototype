import React, { useState } from "react";
import { colors } from "../../utils/colors";
import { Switch } from "@chakra-ui/react";

export default function Header() {
  const [RAGisActive, setRAGisActive] = useState(true);

  const toggleRAG = async (checked) => {
    try {
      await fetch("http://localhost:4000/api/neo4j/togglespeedparcel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ use_speedparcel: checked }),
      });
    } catch (e: any) {
      console.log("Error toggling RAG:", e.message);
    } finally {
      setRAGisActive(checked);
    }
  };

  return (
    <header
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        height: "3.5rem",
        background: colors.dark,
        color: "white",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        zIndex: 1000,
        boxShadow: `0 2px 2px ${colors.purple}`,
        borderColor: colors.purple,
      }}
    >
      <div
        style={{
          maxWidth: "30em",
          width: "100%",
          textAlign: "center",
          fontWeight: 600,
          fontSize: "1.2rem",
          letterSpacing: "0.5px",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <b>Masutā 達人</b> - Your Enterprise Architecture Assistant
      </div>
      <div
        style={{
          position: "absolute",
          top: "50%",
          right: "1rem",
          transform: "translateY(-50%)",
        }}
      >
        <Switch.Root
          colorPalette="green"
          checked={RAGisActive}
          onCheckedChange={({ checked }) => toggleRAG(checked)}
        >
          <Switch.HiddenInput />
          <Switch.Control />
          <Switch.Label>
            {RAGisActive
              ? "Using SpeedParcel Data"
              : "Using playground database"}
          </Switch.Label>
        </Switch.Root>
      </div>
    </header>
  );
}
