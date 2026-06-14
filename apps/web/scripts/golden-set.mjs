// Golden evaluation set for the spike finders (/jobs, /supervisors, /research-pi).
//
// 20 cases spanning diverse backgrounds, all three finder kinds, and every
// country option (CA / US / UK / AU / all). The goal is a fast regression sweep:
// run them all (scripts/eval-finders.mjs) and confirm each returns matches in a
// reasonable time — and catch the slow "anywhere" path (e.g. neuroradiology →
// all) that fans out to 4 country scopes per spike and can time the stream out.
//
// kind:    "jobs" | "supervisors" | "research-pi"
// country: "CA" | "US" | "UK" | "AU" | "all"
// bg:      the background blob the user would paste (kept short but realistic).

export const CASES = [
  // --- the known slow/failing path: 4 scopes × N spikes, serial ---
  {
    id: "neuro-pi-all",
    kind: "research-pi",
    country: "all",
    bg: "Neuroradiologist (MD) focused on brain MRI segmentation and quantitative imaging biomarkers for stroke and small-vessel disease. Looking for a funded lab to host me.",
  },
  {
    id: "neuro-sup-ca",
    kind: "supervisors",
    country: "CA",
    bg: "Neuroradiology, brain MRI segmentation, diffusion imaging, deep learning for lesion detection.",
  },

  // --- engineering / physical sciences ---
  {
    id: "biomech-jobs-ca",
    kind: "jobs",
    country: "CA",
    bg: "Markerless motion capture for human biomechanics: multi-camera pose estimation, musculoskeletal modeling, gait analysis. Built real-time capture pipelines in Python and C++.",
  },
  {
    id: "battery-jobs-ca",
    kind: "jobs",
    country: "CA",
    bg: "Materials scientist working on solid-state electrolytes and lithium-metal anodes for next-gen batteries. Electrochemistry, XRD, in-situ characterization.",
  },
  {
    id: "perovskite-sup-all",
    kind: "supervisors",
    country: "all",
    bg: "Perovskite solar cells, thin-film photovoltaics, stability and encapsulation, device physics.",
  },
  {
    id: "cfd-jobs-uk",
    kind: "jobs",
    country: "UK",
    bg: "Computational fluid dynamics for turbomachinery: RANS/LES, turbine blade cooling, mesh generation, OpenFOAM and in-house solvers.",
  },
  {
    id: "quantum-pi-uk",
    kind: "research-pi",
    country: "UK",
    bg: "Quantum error correction on superconducting qubits, surface codes, cryogenic control electronics.",
  },
  {
    id: "auv-jobs-us",
    kind: "jobs",
    country: "US",
    bg: "Autonomous underwater vehicles: SLAM, acoustic navigation, sensor fusion, marine robotics field trials.",
  },

  // --- life sciences / medical ---
  {
    id: "imaging-jobs-us",
    kind: "jobs",
    country: "US",
    bg: "Medical imaging segmentation with deep learning: U-Net variants, multi-modal CT/MRI, FDA-pathway model validation.",
  },
  {
    id: "mrna-pi-us",
    kind: "research-pi",
    country: "US",
    bg: "mRNA vaccine delivery using lipid nanoparticles, formulation chemistry, immunogenicity assays.",
  },
  {
    id: "crispr-sup-au",
    kind: "supervisors",
    country: "AU",
    bg: "CRISPR gene editing for crop resilience to drought and heat, plant molecular biology, field phenotyping.",
  },
  {
    id: "cardiac-pi-all",
    kind: "research-pi",
    country: "all",
    bg: "Cardiac electrophysiology, catheter ablation mapping, atrial fibrillation, computational heart models.",
  },
  {
    id: "als-sup-all",
    kind: "supervisors",
    country: "all",
    bg: "ALS and neurodegeneration, proteomics of TDP-43 aggregation, iPSC motor-neuron models.",
  },
  {
    id: "healthecon-pi-uk",
    kind: "research-pi",
    country: "UK",
    bg: "Health economics and RCT methodology, cost-effectiveness modeling, trial design and biostatistics.",
  },

  // --- computing / data ---
  {
    id: "nlp-jobs-ca",
    kind: "jobs",
    country: "CA",
    bg: "NLP for low-resource languages: morphological modeling, transfer learning, building corpora and tokenizers for under-served languages.",
  },
  {
    id: "rl-jobs-ca",
    kind: "jobs",
    country: "CA",
    bg: "Reinforcement learning for robotic manipulation, sim-to-real transfer, dexterous grasping, MuJoCo and ROS.",
  },
  {
    id: "cyber-jobs-ca",
    kind: "jobs",
    country: "CA",
    bg: "Cybersecurity: anomaly detection on IoT sensor networks, intrusion detection, embedded device firmware analysis.",
  },

  // --- earth / agri / social ---
  {
    id: "wildfire-pi-ca",
    kind: "research-pi",
    country: "CA",
    bg: "Wildfire remote sensing and fire-spread modeling, satellite imagery, machine learning for burn-severity mapping.",
  },
  {
    id: "agridrone-jobs-au",
    kind: "jobs",
    country: "AU",
    bg: "Agricultural drones with multispectral imaging for crop phenotyping, NDVI analytics, precision-agriculture pipelines.",
  },
  {
    id: "indiglang-sup-ca",
    kind: "supervisors",
    country: "CA",
    bg: "Indigenous language revitalization, community-based linguistics, language documentation and pedagogy.",
  },
];
