export type ProductEdition = "personal" | "pro";

export interface WelcomeCommandItem {
  label: string;
  value: string;
  detail: string;
}

export interface ProductConfig {
  edition: ProductEdition;
  name: string;
  shortName: string;
  documentTitle: string;
  aiName: string;
  welcomeKicker: string;
  welcomeTitle: string;
  welcomeSubtitle: string;
  newProjectTitle: string;
  newProjectDescription: string;
  templateGalleryTitle: string;
  commandCenterTitle: string;
  commandCenterItems: WelcomeCommandItem[];
  compileTip: string;
}

const requestedEdition = import.meta.env.VITE_LATEXDO_EDITION;
const edition: ProductEdition =
  requestedEdition === "pro" || requestedEdition === "business" ? "pro" : "personal";

const configuredName = import.meta.env.VITE_LATEXDO_PRODUCT_NAME?.trim();

const personalName = configuredName || "LatexDo";

const personalProductConfig: ProductConfig = {
  edition: "personal",
  name: personalName,
  shortName: personalName,
  documentTitle: personalName,
  aiName: `${personalName} AI`,
  welcomeKicker: "LaTeX workspace",
  welcomeTitle: personalName,
  welcomeSubtitle: "Start from a working LaTeX document. Compile locally.",
  newProjectTitle: "New LaTeX Project",
  newProjectDescription: "Create a project with a ready-to-build main.tex",
  templateGalleryTitle: "Template gallery",
  commandCenterTitle: "",
  commandCenterItems: [],
  compileTip: "Compile anytime with",
};

const proName = configuredName || "LatexDo Pro";

const proProductConfig: ProductConfig = {
  edition: "pro",
  name: proName,
  shortName: proName,
  documentTitle: proName,
  aiName: `${proName} AI`,
  welcomeKicker: "Business LaTeX workspace",
  welcomeTitle: proName,
  welcomeSubtitle:
    "Create client-ready proposals, board reports, policies, and audited technical deliverables in one company workspace.",
  newProjectTitle: "New Company Document",
  newProjectDescription: "Create a governed business-ready LaTeX project",
  templateGalleryTitle: "Business templates",
  commandCenterTitle: "Company command center",
  commandCenterItems: [
    {
      label: "Confidential drafting",
      value: "Local-first",
      detail: "Keep sensitive company material on the machine by default.",
    },
    {
      label: "Review workflow",
      value: "Tracked",
      detail: "Use history, comments, source control, and PDF checks together.",
    },
    {
      label: "Deliverables",
      value: "PDF ready",
      detail: "Prepare proposals, board packs, policies, and technical reports.",
    },
  ],
  compileTip: "Build the PDF anytime with",
};

export const productConfig =
  edition === "pro" ? proProductConfig : personalProductConfig;

export const productIsPro = productConfig.edition === "pro";
