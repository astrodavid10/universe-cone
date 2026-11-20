<template>
  <div class="cs-backdrop" @click.self="$emit('close')">
    <div ref="panel" class="cs-panel" role="dialog" aria-modal="true" aria-labelledby="cs-title" tabindex="-1">
      <button ref="close" type="button" class="cs-close" aria-label="Close" @click="$emit('close')">
        <font-awesome-icon icon="xmark" />
      </button>
      <h2 id="cs-title">About the cone</h2>
      <p>
        Picture the whole history of the universe as a cone lying on its side. The Big Bang is at the tip,
        today is at the wide mouth, and the cone's width at any point shows how big the universe was then.
        This companion to the INTUITIVE® Planetarium show builds it era by era, then shows the true scale of time.
      </p>
      <p>
        Each step is tagged <strong class="t-m">measured</strong>, <strong class="t-o">modeled</strong> or
        <strong class="t-s">schematic</strong>, so you know which parts are data and which are drawings.
      </p>

      <h3>Data and images</h3>
      <ul>
        <li>
          Cosmology: flat ΛCDM with the <a :href="L.planck18" v-bind="ext">Planck 2018</a> parameters
          (H₀ = 67.4 km/s/Mpc, Ωₘ = 0.315). The true-scale width is the measured expansion of space, a(t).
        </li>
        <li>
          Cosmic microwave background: the Planck 2015 SMICA map, ESA and the Planck Collaboration
          (<a :href="L.pla" v-bind="ext">Planck Legacy Archive</a>). The disc shows the northern Galactic
          hemisphere, drawn for this interactive.
        </li>
        <li>
          Galaxy images, all nearby galaxies used as stand-ins:
          <a :href="L.legacy" v-bind="ext">DESI Legacy Imaging Surveys</a> DR10;
          <a :href="L.ps1" v-bind="ext">Pan-STARRS1 Surveys</a> (Chambers et al. 2016);
          Digitized Sky Survey 2 (STScI; Palomar and UK Schmidt), via CDS
          <a :href="L.hips2fits" v-bind="ext">hips2fits</a> and the Legacy Surveys viewer.
        </li>
        <li>Reionization bubbles, hydrogen fog and particles: schematic.</li>
      </ul>

      <p class="cs-fine">Concept, design and dome build: A. David Weigel, INTUITIVE® Planetarium.</p>

      <div class="cs-logos">
        <a
          class="cs-logo-link" href="https://www.rocketcenter.com/INTUITIVEPlanetarium" target="_blank"
          rel="noopener" aria-label="INTUITIVE Planetarium at the U.S. Space &amp; Rocket Center"
        >
          <img class="cs-logo-ip" src="../assets/ip-ussrc.png" alt="INTUITIVE Planetarium at the U.S. Space &amp; Rocket Center">
        </a>
        <a class="cs-attr" href="https://www.cosmicds.cfa.harvard.edu/" target="_blank" rel="noopener">
          <img src="../assets/logo_cosmicds.png" alt="CosmicDS">
          <span>A Cosmic Data Stories interactive</span>
        </a>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";

const CREDIT_LINKS = {
  planck18: "https://arxiv.org/abs/1807.06209",
  pla: "https://pla.esac.esa.int/",
  legacy: "https://www.legacysurvey.org/acknowledgment/",
  ps1: "https://outerspace.stsci.edu/display/PANSTARRS/",
  hips2fits: "https://alasky.cds.unistra.fr/hips-image-services/hips2fits",
};

export default defineComponent({
  name: "CreditsSheet",
  emits: ["close"],
  data() {
    return {
      ext: { target: "_blank", rel: "noopener" },
      // eslint-disable-next-line @typescript-eslint/naming-convention
      L: CREDIT_LINKS,
    };
  },
  mounted() {
    (this.$refs.close as HTMLElement | undefined)?.focus();
    window.addEventListener("keydown", this.onKey);
  },
  beforeUnmount() { window.removeEventListener("keydown", this.onKey); },
  methods: {
    onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") { this.$emit("close"); return; }
      if (e.key !== "Tab") { return; }
      const panel = this.$refs.panel as HTMLElement | undefined;
      if (!panel) { return; }
      const items = panel.querySelectorAll<HTMLElement>("a[href], button");
      if (!items.length) { return; }
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (
        !e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    },
  },
});
</script>

<style lang="less">
.cs-backdrop {
  position: fixed; inset: 0; z-index: 60; background: rgba(2, 1, 8, 0.72);
  display: flex; align-items: flex-start; justify-content: center; overflow-y: auto; padding: 16px;
}
.cs-panel {
  position: relative; width: min(100%, 34rem); margin: auto; padding: 18px 20px 20px;
  background: #0f0a26; border: 1px solid rgba(180, 140, 255, 0.25); border-radius: 16px; color: #eef0ff;
  h2 { margin: 0 44px 10px 0; font-size: 22px; }
  h3 { margin: 16px 0 6px; font-size: 16px; }
  p, li { font-size: 15px; line-height: 1.45; }
  p + p { margin-top: 8px; }
  ul { margin: 0; padding-left: 18px; li { margin-bottom: 6px; } }
  a { color: #ffc66b; }
  .t-m { color: #9be29b; } .t-o { color: #ffd166; } .t-s { color: #c9a7ff; }
}
.cs-close {
  position: absolute; top: 8px; right: 8px; width: 44px; height: 44px; display: grid; place-items: center;
  font-size: 20px; color: #b9bfe6; cursor: pointer; border-radius: 10px;
  &:focus-visible { outline: 3px solid #ffc66b; }
}
.cs-fine { margin: 16px 0 0; font-style: italic; color: #b9bfe6; font-size: 14px; }
.cs-logos {
  display: flex; flex-direction: column; align-items: center; gap: 10px; margin-top: 14px; padding-top: 14px;
  border-top: 1px solid rgba(180, 140, 255, 0.2);
}
.cs-logo-ip { display: block; max-width: 13rem; height: auto; }
.cs-attr {
  display: flex; align-items: center; gap: 10px; color: #dfe3ff !important; text-decoration: none; font-size: 14px;
  img { width: 28px; height: 28px; object-fit: contain; }
}
</style>
