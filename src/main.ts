import { createApp } from "vue";

import App from "./App.vue";
import { boolParam } from "./urlParams";
import "./assets/cone.less";

import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome";
import { library } from "@fortawesome/fontawesome-svg-core";
import {
  faChevronDown, faChevronLeft, faChevronRight, faChevronUp, faCircleInfo, faPause, faPlay, faShareNodes, faXmark,
} from "@fortawesome/free-solid-svg-icons";
library.add(faChevronDown, faChevronLeft, faChevronRight, faChevronUp, faCircleInfo, faPause, faPlay, faShareNodes, faXmark);

// iOS Safari: stop page-level pinch zoom; the 3D canvas handles its own pinch.
document.addEventListener("gesturestart", (e) => e.preventDefault(), { passive: false });

createApp(App, {
  kioskMode: boolParam("kiosk"),
  // The take-home QR must point at the public site, never at a LAN/localhost address (sol footgun 42).
  kioskHomeUrl: process.env.VUE_APP_PUBLIC_URL ?? "",
})
  .component("font-awesome-icon", FontAwesomeIcon)
  .mount("#app");
