import { createTheme } from "@mui/material/styles";

declare module "@mui/material/styles" {
  interface Palette {
    success: Palette["primary"];
    warning: Palette["primary"];
  }
}

const theme = createTheme({
  palette: {
    primary: {
      main: "#0b57d0",
      contrastText: "#ffffff",
      light: "#d3e3fd",
      dark: "#041e49",
    },
    error: {
      main: "#b3261e",
      light: "#f9dedc",
      dark: "#8c1d18",
    },
    success: {
      main: "#137333",
      light: "#e6f4ea",
      dark: "#0f5f2b",
    },
    warning: {
      main: "#b06000",
      light: "#fef7e0",
      dark: "#7a4100",
    },
    background: {
      default: "#f1f3f4",
      paper: "#ffffff",
    },
    text: {
      primary: "#1f1f1f",
      secondary: "#5f6368",
    },
    divider: "#dadce0",
    action: {
      hover: "rgba(11, 87, 208, 0.04)",
    },
  },
  typography: {
    fontFamily:
      '"Google Sans", "Product Sans", Roboto, system-ui, sans-serif',
    h1: {
      fontSize: "2rem",
      fontWeight: 400,
      lineHeight: 1.25,
      letterSpacing: 0,
    },
    h2: {
      fontSize: "1.375rem",
      fontWeight: 500,
      lineHeight: 1.3,
    },
    h3: {
      fontSize: "1rem",
      fontWeight: 500,
      lineHeight: 1.4,
    },
    body1: {
      fontSize: "0.875rem",
      lineHeight: 1.6,
    },
    body2: {
      fontSize: "0.8125rem",
      lineHeight: 1.4,
    },
    overline: {
      fontSize: "0.6875rem",
      fontWeight: 700,
      letterSpacing: "0.09em",
      textTransform: "uppercase" as const,
      lineHeight: 1.5,
    },
  },
  shape: {
    borderRadius: 12,
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: "none" as const,
          fontWeight: 500,
        },
      },
    },
    MuiCard: {
      defaultProps: {
        variant: "outlined",
      },
      styleOverrides: {
        root: {
          borderColor: "#dadce0",
        },
      },
    },
    MuiTextField: {
      defaultProps: {
        variant: "outlined",
        size: "small",
        fullWidth: true,
      },
    },
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          WebkitFontSmoothing: "antialiased",
        },
      },
    },
  },
});

export default theme;
