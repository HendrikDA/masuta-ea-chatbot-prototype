import React, { useEffect, useMemo, useState } from "react";
import { colors } from "../../utils/colors";
import { Switch } from "@chakra-ui/react";
import { CustomMenu } from "./Menu";
import { loadActiveDb, saveActiveDb } from "../../utils/dbToggle";

interface HeaderProps {
  activeDb: "playground" | "speedparcel";
  onDbChange: (db: "playground" | "speedparcel") => void;
}

export default function Header({ activeDb, onDbChange }: HeaderProps) {
  const speedParcelIsActive = activeDb === "speedparcel";

  // Sync backend to cookie value on mount AND whenever activeDb changes
  useEffect(() => {
    fetch("http://localhost:4000/api/neo4j/togglespeedparcel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ use_speedparcel: speedParcelIsActive }),
    }).catch((e) => console.log("Error toggling DB:", e));
  }, [speedParcelIsActive]);

  const toggleSpeedParcelOrPlayground = async (checked: boolean) => {
    const nextDb = checked ? "speedparcel" : "playground";
    saveActiveDb(nextDb);
    onDbChange(nextDb);
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
          position: "absolute",
          left: "1rem",
        }}
      >
        <CustomMenu speedParcelIsActive={speedParcelIsActive} />
      </div>
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
          checked={speedParcelIsActive}
          onCheckedChange={({ checked }) =>
            toggleSpeedParcelOrPlayground(checked)
          }
          default={true}
        >
          <Switch.HiddenInput />
          <Switch.Control />
          <Switch.Label>
            {speedParcelIsActive
              ? "Using SpeedParcel Data"
              : "Using playground database"}
          </Switch.Label>
        </Switch.Root>
      </div>
    </header>
  );
}
