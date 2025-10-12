import React from "react";
import { colors } from "../../utils/colors";

export default function Header() {
  return (
    <header
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        height: "3.5rem",
        backgroundColor: colors.darkBlue,
        color: "white",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        zIndex: 1000,
        boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
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
        <b>Masuta</b> - Your Enterprise Architecture Assistant
      </div>
    </header>
  );
}
