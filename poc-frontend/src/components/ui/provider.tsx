"use client";

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { ColorModeProvider, type ColorModeProviderProps } from "./color-mode";
import React from "react";
import { colors } from "../../utils/colors";

export function Provider(props: ColorModeProviderProps) {
  // add black background to entire app
  const styles = {
    backgroundColor: colors.dark,
    color: "white",
    minHeight: "100vh",
  };
  return (
    // add black background to entire app
    <ChakraProvider value={defaultSystem}>
      <div style={styles}>
        <ColorModeProvider {...props} />
      </div>
    </ChakraProvider>
  );
}
