import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { gsap } from 'gsap';
import { CELESTIALS, SATELLITES, ALL_BODIES } from '../data/celestials.js';
import { createGlowTexture } from '../universe/proceduralTextures.js';
import { createGalaxy, createStarfield } from '../universe/createGalaxy.js';
import { createSolarSystem } from '../universe/createSolarSystem.js';

const GALAXY_CAMERA = new THREE.Vector3(0, 15, 116);
const SOLAR_CAMERA = new THREE.Vector3(0, 42, 100);
const ORIGIN = new THREE.Vector3(0, 0, 0);

export class UniverseApp {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.labelsLayer = options.labelsLayer;
    this.transitionElement = options.transitionElement;
    this.onStateChange = options.onStateChange || (() => {});
    this.onCameraUpdate = options.onCameraUpdate || (() => {});
    this.onToast = options.onToast || (() => {});
    this.onTelemetry = options.onTelemetry || (() => {});
    this.mode = 'galaxy';
    this.focusId = null;
    this.timeScale = 1;
    this.flightSpeed = 1;
    this.paused = false;
    this.qualityMode = 'auto';
    this.fps = 60;
    this.lowFpsDuration = 0;
    this.goodFpsDuration = 0;
    this.qualityCooldown = 0;
    this.adaptiveRatio = 1;
    this.frameSampleSeconds = 0;
    this.frameSamples = 0;
    this.performanceSamples = [];
    this.isCompact = this.usesCompactLayout();
    this.autoQualityTier = this.isCompact ? 1 : 2;
    this.visualQualityTier = this.autoQualityTier;
    this.pageVisible = !document.hidden;
    this.showOrbits = true;
    this.showLabels = true;
    this.transitioning = false;
    this.flying = false;
    this.focusFlight = null;
    this.lastTrackedPosition = null;
    this.keys = new Set();
    this.pointerStart = null;
    this.activePointerIds = new Set();
    this.multiTouchGesture = false;
    this.frame = 0;
    this.elapsed = 0;
    this.clock = new THREE.Clock();

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#030711');
    this.camera = new THREE.PerspectiveCamera(49, window.innerWidth / window.innerHeight, .06, 1600);
    this.camera.position.copy(GALAXY_CAMERA);
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance'
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.4;
    this.pixelRatio = this.getTargetPixelRatio();
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight), .5, .4, .84
    );
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());
    this.composer.setPixelRatio(this.pixelRatio);
    this.composer.setSize(window.innerWidth, window.innerHeight);
    this.useBloom = !this.isCompact;

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = .06;
    this.controls.rotateSpeed = .52;
    this.controls.zoomSpeed = .83;
    this.controls.panSpeed = .7;
    this.controls.minDistance = 6;
    this.controls.maxDistance = 290;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = .14;
    this.controls.touches.ONE = THREE.TOUCH.ROTATE;
    this.controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;
    this.controls.target.copy(ORIGIN);

    this.scene.add(new THREE.HemisphereLight(0x8ca9d5, 0x14111c, .75));
    this.scene.add(new THREE.AmbientLight(0x8ea6cb, .19));
    const glowTexture = createGlowTexture();
    this.starfield = createStarfield(this.pixelRatio);
    this.scene.add(this.starfield);
    this.galaxy = createGalaxy(glowTexture, this.pixelRatio, this.isCompact ? .68 : 1);
    this.scene.add(this.galaxy.group);
    this.solar = createSolarSystem(glowTexture, this.renderer);
    this.scene.add(this.solar.group);
    this.applyVisualQuality();

    this.raycaster = new THREE.Raycaster();
    this.pointerNdc = new THREE.Vector2();
    this.labels = new Map();
    this.labelSizes = new WeakMap();
    this.labelResizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(entries => {
      for (const entry of entries) this.labelSizes.delete(entry.target);
    });
    this.createLabels();
    // Keep local JPG requests deferred while the initial galaxy is shown.
    // Procedural solar materials are already available if a user enters early.
    this.bindEvents();
    this.emitState();
    this.animate();
  }

  createLabels() {
    if (!this.labelsLayer) return;
    for (const body of ALL_BODIES) {
      const label = document.createElement('div');
      label.className = 'planet-label';
      label.textContent = body.name;
      this.labelsLayer.appendChild(label);
      this.labels.set(body.id, label);
      this.labelResizeObserver?.observe(label);
    }
    this.galaxyLabel = document.createElement('div');
    this.galaxyLabel.className = 'galaxy-marker-label';
    this.galaxyLabel.textContent = '✦ 太阳系 · SOLAR SYSTEM';
    this.labelsLayer.appendChild(this.galaxyLabel);
    this.labelResizeObserver?.observe(this.galaxyLabel);
  }

  getLabelSize(label, fallbackWidth, fallbackHeight) {
    let size = this.labelSizes.get(label);
    if (!size) {
      size = { width: label.offsetWidth || fallbackWidth, height: label.offsetHeight || fallbackHeight };
      this.labelSizes.set(label, size);
    }
    return size;
  }

  getTargetPixelRatio() {
    const native = window.devicePixelRatio || 1;
    const cap = this.qualityMode === 'high' ? 2 :
      this.qualityMode === 'low' ? 1 : this.isCompact ? 1.2 : 1.75;
    return Math.min(native, cap);
  }

  applyRenderResolution() {
    const ratio = Math.max(.75, this.getTargetPixelRatio() *
      (this.qualityMode === 'auto' ? this.adaptiveRatio : 1));
    if (Math.abs(ratio - this.pixelRatio) < .005) return;
    this.pixelRatio = ratio;
    this.renderer.setPixelRatio(ratio);
    this.composer.setPixelRatio(ratio);
    this.composer.setSize(window.innerWidth, window.innerHeight);
    this.galaxy.resize(ratio);
    this.starfield.material.uniforms.uPixelRatio.value = ratio;
  }

  applyVisualQuality() {
    const tier = this.qualityMode === 'low' ? 0 :
      this.qualityMode === 'high' ? 2 : this.autoQualityTier;
    this.visualQualityTier = tier;
    this.galaxy.setQualityTier(tier);
    this.starfield.geometry.setDrawRange(0, [2300, 3800, 5200][tier]);
    this.solar.setQualityTier(tier);
    this.useBloom = this.qualityMode === 'high' ||
      (this.qualityMode === 'auto' && tier === 2 && !this.isCompact);
  }

  usesCompactLayout() {
    return window.matchMedia('(max-width: 640px), (max-width: 900px) and (max-height: 480px)').matches;
  }

  getSceneSafeRect() {
    const width = window.innerWidth, height = window.innerHeight;
    if (!this.isCompact) return { left: 0, right: width, top: 0, bottom: height };

    const bounds = selector => document.querySelector(selector)?.getBoundingClientRect();
    const header = bounds('.topbar');
    const footer = bounds('.bottom-interface');
    const detail = bounds('.detail-panel.is-visible');
    const top = Math.max(8, (header?.bottom ?? 88) + 8);
    let bottom = Math.min(height - 8, (footer?.top ?? height - 74) - 9);
    // Temporary menus float over the canvas; opening them must not move the camera.
    // In landscape the sheet sits on the left and does not cover the scene centre.
    if (detail?.height && detail.left < width / 2 && detail.right > width / 2) {
      bottom = Math.min(bottom, detail.top - 9);
    }
    return { left: 8, right: width - 8, top, bottom: Math.max(top + 64, bottom) };
  }

  getFocusShift(distance) {
    if (!this.isCompact) return new THREE.Vector3();
    const safe = this.getSceneSafeRect();
    const centerY = (safe.top + safe.bottom) / 2;
    const offset = THREE.MathUtils.clamp(centerY / window.innerHeight - .5, -.43, .43);
    const visibleWorldHeight = 2 * distance * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    return new THREE.Vector3(0, offset * visibleWorldHeight, 0);
  }

  reframeFocusedBody() {
    if (!this.isCompact || this.mode !== 'planet' || !this.focusId || this.flying || this.transitioning) return;
    const body = this.solar.bodies[this.focusId];
    if (!body) return;
    const position = body.root.getWorldPosition(new THREE.Vector3());
    const distance = this.camera.position.distanceTo(position);
    const shift = position.add(this.getFocusShift(distance)).sub(this.controls.target);
    if (shift.lengthSq() < .0004) return;
    this.reframeTween?.kill();
    const motion = { progress: 0 };
    let previous = 0;
    this.reframeTween = gsap.to(motion, {
      progress: 1,
      duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : .32,
      ease: 'power2.out',
      onUpdate: () => {
        // Pan camera and orbit pivot by the same delta while the planet moves.
        const step = shift.clone().multiplyScalar(motion.progress - previous);
        this.camera.position.add(step);
        this.controls.target.add(step);
        previous = motion.progress;
      }
    });
  }

  clearCameraMomentum() {
    this.reframeTween?.kill();
    // OrbitControls keeps rotation/pan inertia even when `enabled` is false.
    // Consume it before GSAP takes ownership of the camera.
    const damping = this.controls.enableDamping;
    const autoRotate = this.controls.autoRotate;
    this.controls.enableDamping = false;
    this.controls.autoRotate = false;
    this.controls.update();
    this.controls.enableDamping = damping;
    this.controls.autoRotate = autoRotate;
  }

  setQuality(mode) {
    this.qualityMode = ['auto', 'low', 'high'].includes(mode) ? mode : 'auto';
    this.autoQualityTier = this.isCompact ? 1 : 2;
    this.adaptiveRatio = 1;
    this.lowFpsDuration = 0;
    this.goodFpsDuration = 0;
    this.qualityCooldown = 12;
    this.applyVisualQuality();
    this.applyRenderResolution();
    this.emitState();
  }

  bindEvents() {
    this.handleResize = () => {
      this.labelSizes = new WeakMap();
      const wasCompact = this.isCompact;
      this.isCompact = this.usesCompactLayout();
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      if (wasCompact !== this.isCompact) {
        this.autoQualityTier = this.isCompact ? 1 : 2;
        this.adaptiveRatio = 1;
        this.applyVisualQuality();
      }
      this.applyRenderResolution();
      this.renderer.setSize(window.innerWidth, window.innerHeight, false);
      this.composer.setSize(window.innerWidth, window.innerHeight);
      this.galaxy.resize(this.pixelRatio);
      this.starfield.material.uniforms.uPixelRatio.value = this.pixelRatio;
    };
    window.addEventListener('resize', this.handleResize);
    this.canvas.addEventListener('pointerdown', event => {
      this.reframeTween?.kill();
      this.activePointerIds.add(event.pointerId);
      if (this.activePointerIds.size > 1) this.multiTouchGesture = true;
      if (this.activePointerIds.size === 1) {
        this.pointerStart = { id: event.pointerId, x: event.clientX, y: event.clientY };
      }
    });
    this.canvas.addEventListener('pointerup', event => {
      this.activePointerIds.delete(event.pointerId);
      const canSelect = this.pointerStart?.id === event.pointerId &&
        !this.multiTouchGesture && !this.transitioning && !this.flying;
      const travel = canSelect ?
        Math.hypot(event.clientX - this.pointerStart.x, event.clientY - this.pointerStart.y) : Infinity;
      this.pointerStart = null;
      if (travel < 6 && event.button === 0) this.selectFromPointer(event);
      if (this.activePointerIds.size === 0) this.multiTouchGesture = false;
    });
    this.canvas.addEventListener('pointercancel', event => {
      this.activePointerIds.delete(event.pointerId);
      this.pointerStart = null;
      if (this.activePointerIds.size === 0) this.multiTouchGesture = false;
    });
    this.canvas.addEventListener('pointermove', event => {
      if (event.pointerType === 'touch') return;
      if (!this.solar.group.visible || this.transitioning) {
        this.canvas.style.cursor = 'grab';
        return;
      }
      this.canvas.style.cursor = this.pickBody(event) ? 'pointer' : 'grab';
    });
    this.canvas.addEventListener('pointerleave', () => {
      this.pointerStart = null;
      this.canvas.style.cursor = 'grab';
    });
    this.handleKeyDown = event => {
      if (event.target instanceof HTMLElement && ['INPUT', 'TEXTAREA'].includes(event.target.tagName)) return;
      if (document.querySelector('.modal-overlay.is-open')) return;
      if (['Space', 'ArrowUp', 'ArrowDown'].includes(event.code) && this.mode === 'free') event.preventDefault();
      this.keys.add(event.code);
    };
    this.handleKeyUp = event => this.keys.delete(event.code);
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', () => this.keys.clear());
    this.handleVisibilityChange = () => {
      this.pageVisible = !document.hidden;
      this.frameSampleSeconds = 0;
      this.frameSamples = 0;
      this.lowFpsDuration = 0;
      this.goodFpsDuration = 0;
      if (!this.pageVisible) {
        cancelAnimationFrame(this.animationId);
        this.animationId = null;
        this.keys.clear();
      } else if (this.animationId === null) {
        this.clock.getDelta(); // Discard the time spent in the background.
        this.animate();
      }
    };
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
  }

  pickBody(event) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointerNdc.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const hits = this.raycaster.intersectObjects(this.solar.raycastMeshes, false);
    return hits.length ? hits[0].object.userData.bodyId : null;
  }

  selectFromPointer(event) {
    if (this.mode === 'galaxy') {
      const rect = this.canvas.getBoundingClientRect();
      this.pointerNdc.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      );
      this.raycaster.setFromCamera(this.pointerNdc, this.camera);
      if (this.raycaster.intersectObject(this.galaxy.beaconCore).length) this.viewSolar();
      return;
    }
    if (!this.solar.group.visible) return;
    const id = this.pickBody(event);
    if (id) this.focusBody(id);
  }

  emitState() {
    this.onStateChange({
      mode: this.mode,
      focusId: this.focusId,
      paused: this.paused,
      timeScale: this.timeScale,
      flightSpeed: this.flightSpeed,
      qualityMode: this.qualityMode,
      showOrbits: this.showOrbits,
      showLabels: this.showLabels
    });
  }

  getSolarOverview() {
    // Give the solar system the right side of a portrait screen, where the
    // introductory copy does not cover it.
    if (window.innerWidth <= 640) {
      return {
        camera: new THREE.Vector3(-10, 42, 100),
        target: new THREE.Vector3(-10, 0, 0)
      };
    }
    return { camera: SOLAR_CAMERA, target: ORIGIN };
  }

  changeScene(destination) {
    if (this.transitioning) return Promise.resolve(false);
    const toSolar = destination !== 'galaxy';
    this.solar.setTextureLoadingEnabled(toSolar);
    if (toSolar) this.solar.loadOverviewTextures();
    this.transitioning = true;
    this.flying = true;
    if (this.flightTween) this.flightTween.kill();
    this.focusFlight = null;
    gsap.killTweensOf(this.camera.position);
    gsap.killTweensOf(this.controls.target);
    if (this.sceneTimeline) this.sceneTimeline.kill();
    this.controls.enabled = false;
    this.clearCameraMomentum();

    return new Promise(resolve => {
      const fromGalaxy = this.mode === 'galaxy';
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const startPos = this.camera.position.clone();
      const startTarget = this.controls.target.clone();
      const marker = this.galaxy.beacon.getWorldPosition(new THREE.Vector3());
      const flyDestination = fromGalaxy ? marker.clone().add(new THREE.Vector3(0, 5, 9)) :
        startPos.clone().add(startPos.clone().sub(startTarget).normalize().multiplyScalar(38));
      const flyTarget = fromGalaxy ? marker : ORIGIN;
      const flight = { t: 0 };
      this.sceneTimeline = gsap.timeline({ onComplete: () => {
        this.transitioning = false;
        this.flying = false;
        this.controls.enabled = true;
        resolve(true);
      }});
      if (!reduceMotion) {
        this.sceneTimeline.to(flight, {
          t: 1, duration: fromGalaxy ? 1.2 : .9, ease: 'power3.inOut',
          onUpdate: () => {
            this.camera.position.copy(startPos).lerp(flyDestination, flight.t);
            this.controls.target.copy(startTarget).lerp(flyTarget, flight.t);
          }
        });
      }
      this.sceneTimeline.to(this.transitionElement, {
        opacity: 1, duration: reduceMotion ? .18 : .35, ease: 'power2.in',
        onComplete: () => {
          this.focusId = null;
          this.lastTrackedPosition = null;
          this.mode = destination;
          this.solar.group.visible = toSolar;
          this.galaxy.group.visible = !toSolar;
          const overview = this.getSolarOverview();
          const endPos = toSolar ? overview.camera : GALAXY_CAMERA;
          const endTarget = toSolar ? overview.target : ORIGIN;
          this.camera.position.copy(endPos).multiplyScalar(toSolar ? 1.14 : .76);
          this.controls.target.copy(endTarget);
          this.controls.minDistance = toSolar ? 1.1 : 6;
          this.controls.maxDistance = toSolar ? 220 : 290;
          this.controls.autoRotate = !toSolar;
          this.camera.lookAt(this.controls.target);
          this.emitState();
          gsap.to(this.camera.position, {
            x: endPos.x, y: endPos.y, z: endPos.z,
            duration: reduceMotion ? .01 : .85, ease: 'power2.out'
          });
        }
      });
      this.sceneTimeline.to(this.transitionElement, {
        opacity: 0, duration: reduceMotion ? .2 : .9, ease: 'power2.out'
      });
    });
  }

  animateCamera(destination, target, duration = 1.8) {
    if (this.flightTween) this.flightTween.kill();
    this.focusFlight = null;
    gsap.killTweensOf(this.camera.position);
    gsap.killTweensOf(this.controls.target);
    this.flying = true;
    this.controls.enabled = false;
    this.clearCameraMomentum();
    const startPos = this.camera.position.clone();
    const startTarget = this.controls.target.clone();
    const midpoint = startPos.clone().lerp(destination, .5)
      .add(new THREE.Vector3(0, startPos.distanceTo(destination) * .1, 0));
    const motion = { t: 0 };
    this.flightTween = gsap.to(motion, {
      t: 1,
      duration,
      ease: 'power3.inOut',
      onUpdate: () => {
        const t = motion.t, s = 1 - t;
        this.camera.position.set(
          s * s * startPos.x + 2 * s * t * midpoint.x + t * t * destination.x,
          s * s * startPos.y + 2 * s * t * midpoint.y + t * t * destination.y,
          s * s * startPos.z + 2 * s * t * midpoint.z + t * t * destination.z
        );
        this.controls.target.copy(startTarget).lerp(target, motion.t);
      },
      onComplete: () => {
        this.flying = false;
        this.controls.enabled = true;
      }
    });
  }

  async viewGalaxy() {
    if (this.transitioning) return;
    if (this.mode !== 'galaxy') {
      await this.changeScene('galaxy');
    } else {
      this.focusId = null;
      this.controls.autoRotate = true;
      this.animateCamera(GALAXY_CAMERA, ORIGIN);
      this.emitState();
    }
  }

  async viewSolar() {
    if (this.transitioning) return;
    if (this.mode === 'galaxy') {
      await this.changeScene('solar');
    } else {
      this.solar.setTextureLoadingEnabled(true);
      this.solar.loadOverviewTextures();
      this.mode = 'solar';
      this.focusId = null;
      this.lastTrackedPosition = null;
      this.controls.autoRotate = false;
      this.controls.minDistance = 2;
      this.controls.maxDistance = 220;
      const overview = this.getSolarOverview();
      this.animateCamera(overview.camera, overview.target);
      this.emitState();
    }
  }

  async activateFree() {
    if (this.transitioning) return;
    if (this.mode === 'galaxy') await this.changeScene('free');
    else this.solar.setTextureLoadingEnabled(true);
    this.mode = 'free';
    this.focusId = null;
    this.lastTrackedPosition = null;
    if (this.flightTween) this.flightTween.kill();
    this.focusFlight = null;
    gsap.killTweensOf(this.camera.position);
    gsap.killTweensOf(this.controls.target);
    this.flying = false;
    this.controls.enabled = true;
    this.controls.autoRotate = false;
    this.controls.minDistance = .6;
    this.emitState();
    this.onToast('自由漫游已开启 · 使用 W A S D 与空格 / Shift 移动');
  }

  async focusBody(id) {
    const body = this.solar.bodies[id];
    if (!body || this.transitioning) return;
    // Selecting a target promotes its pending texture above overview/idle work.
    this.solar.requestTexture(id, 'focus');
    this.solar.requestNearbyTextures(id);
    if (this.mode === 'galaxy') {
      const switched = await this.changeScene('solar');
      if (!switched) return;
    }
    if (this.flightTween) this.flightTween.kill();
    this.focusFlight = null;
    // Scene transitions can leave a short camera-position tween alive.
    // Cancel it before starting the next body flight.
    gsap.killTweensOf(this.camera.position);
    gsap.killTweensOf(this.controls.target);
    this.flying = true;
    this.controls.enabled = false;
    this.controls.autoRotate = false;
    this.clearCameraMomentum();
    this.mode = 'planet';
    this.focusId = id;
    this.lastTrackedPosition = null;
    this.controls.minDistance = Math.max(.65, body.data.radius * 1.5);
    this.controls.maxDistance = 160;
    this.emitState();

    const compact = this.isCompact;
    const scale = compact ? (id === 'saturn' ? 12.5 : 9.3) : (id === 'sun' ? 5.5 : 6.3);
    const distance = Math.max(body.data.parentId ? (compact ? 2.7 : 1.35) : (compact ? 5 : 3.3), body.data.radius * scale);
    const offset = new THREE.Vector3(distance * .55, distance * .31, distance);
    const startPos = this.camera.position.clone();
    const startTarget = this.controls.target.clone();
    const midpoint = startPos.clone().lerp(body.root.getWorldPosition(new THREE.Vector3()).add(offset), .46);
    midpoint.y += Math.min(24, startPos.distanceTo(midpoint) * .13);
    // GSAP advances progress only. The camera samples the planet's current
    // world position in animate(), after this frame's orbital simulation.
    const flight = {
      body, offset, startPos, startTarget, midpoint,
      focusShift: this.getFocusShift(offset.length()),
      t: 0, complete: false,
      now: new THREE.Vector3(),
      destination: new THREE.Vector3(),
      target: new THREE.Vector3()
    };
    this.focusFlight = flight;
    this.flightTween = gsap.to(flight, {
      t: 1,
      duration: 1.9,
      ease: 'power3.inOut',
      onComplete: () => {
        // Finish after animate() has rendered the last tween sample.
        if (this.focusFlight === flight) flight.complete = true;
      }
    });
  }

  updateFocusFlight() {
    const flight = this.focusFlight;
    if (!flight) return;
    flight.body.root.getWorldPosition(flight.now);
    flight.destination.copy(flight.now).add(flight.offset);
    const t = flight.t, s = 1 - t;
    this.camera.position.copy(flight.startPos).multiplyScalar(s * s)
      .addScaledVector(flight.midpoint, 2 * s * t)
      .addScaledVector(flight.destination, t * t);
    flight.target.copy(flight.now).add(flight.focusShift);
    this.controls.target.copy(flight.startTarget).lerp(flight.target, t);

    if (flight.complete) {
      this.lastTrackedPosition = flight.now.clone();
      this.focusFlight = null;
      this.flying = false;
      this.controls.enabled = true;
    }
  }

  setTimeScale(value) {
    this.timeScale = Math.max(0, Math.min(50, Number(value)));
    if (this.timeScale > 0 && this.paused) this.paused = false;
    this.emitState();
  }

  togglePaused() {
    this.paused = !this.paused;
    this.emitState();
  }

  toggleOrbits() {
    this.showOrbits = !this.showOrbits;
    this.solar.setOrbitsVisible(this.showOrbits);
    this.emitState();
  }

  toggleLabels() {
    this.showLabels = !this.showLabels;
    this.emitState();
  }

  setFlightSpeed(value) {
    this.flightSpeed = Math.max(.5, Math.min(4, Number(value)));
    this.emitState();
  }

  zoom(factor) {
    const offset = this.camera.position.clone().sub(this.controls.target);
    const distance = offset.length();
    const desired = THREE.MathUtils.clamp(distance * factor, this.controls.minDistance, this.controls.maxDistance);
    this.camera.position.copy(this.controls.target).add(offset.multiplyScalar(desired / distance));
  }

  updateFreeMovement(delta) {
    if (this.mode !== 'free' || this.flying || this.transitioning) return;
    const forward = this.camera.getWorldDirection(new THREE.Vector3());
    const right = new THREE.Vector3().crossVectors(forward, this.camera.up).normalize();
    const movement = new THREE.Vector3();
    if (this.keys.has('KeyW')) movement.add(forward);
    if (this.keys.has('KeyS')) movement.sub(forward);
    if (this.keys.has('KeyD')) movement.add(right);
    if (this.keys.has('KeyA')) movement.sub(right);
    if (this.keys.has('Space')) movement.y += 1;
    if (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) movement.y -= 1;
    if (movement.lengthSq() === 0) return;
    movement.normalize().multiplyScalar(17 * delta * this.flightSpeed);
    this.camera.position.add(movement);
    this.controls.target.add(movement);
    for (const body of CELESTIALS) {
      if (body.id === 'sun' || !this.solar.group.visible) continue;
      const location = this.solar.bodies[body.id].root.getWorldPosition(new THREE.Vector3());
      const deltaPos = this.camera.position.clone().sub(location);
      const safeRadius = body.radius * 1.08;
      if (deltaPos.lengthSq() < safeRadius * safeRadius) {
        this.camera.position.copy(location).add(deltaPos.normalize().multiplyScalar(safeRadius));
        this.controls.target.add(this.camera.position.clone().sub(location).multiplyScalar(.02));
      }
    }
  }

  updateLabels() {
    const show = this.showLabels && this.solar.group.visible && !this.transitioning;
    const width = window.innerWidth, height = window.innerHeight;
    const safe = this.getSceneSafeRect();
    const world = new THREE.Vector3();
    const focusedMoon = SATELLITES.some(moon => moon.id === this.focusId);
    const protectedAreas = [
      '.topbar', '.bottom-interface', '.hero-panel:not(.is-hidden)',
      '.detail-panel.is-visible', '.camera-tools', '.mobile-menu:not([hidden])',
      '#app[data-dock="open"] .planet-dock'
    ]
      .map(selector => document.querySelector(selector))
      .filter(Boolean)
      .map(element => element.getBoundingClientRect())
      .filter(rect => rect.width > 0 && rect.height > 0);
    const overlaps = (labelBounds, region) =>
      labelBounds.left < region.right + 8 &&
      labelBounds.right > region.left - 8 &&
      labelBounds.top < region.bottom + 8 &&
      labelBounds.bottom > region.top - 8;
    const usedLabels = [];
    for (const body of ALL_BODIES) {
      const label = this.labels.get(body.id);
      if (!label) continue;
      const showSatellite = !body.parentId ||
        (this.mode === 'planet' && (
          this.focusId === body.parentId ||
          (focusedMoon && this.solar.bodies[this.focusId].data.parentId === body.parentId)
        ));
      if (!show || !showSatellite) {
        label.classList.remove('is-visible');
        continue;
      }
      this.solar.bodies[body.id].root.getWorldPosition(world);
      world.y += body.radius * 1.55;
      world.project(this.camera);
      const x = (world.x * .5 + .5) * width;
      const y = (-world.y * .5 + .5) * height;
      const size = this.getLabelSize(label, 74, 24);
      const halfWidth = size.width / 2;
      const halfHeight = size.height / 2;
      const labelBounds = { left: x - halfWidth, right: x + halfWidth, top: y - halfHeight, bottom: y + halfHeight };
      const visible = world.z < 1 && world.z > -1 &&
        Math.abs(world.x) < .92 && Math.abs(world.y) < .90 &&
        !(this.mode === 'planet' && body.id === this.focusId) &&
        (!this.isCompact || (
          labelBounds.left > safe.left && labelBounds.right < safe.right &&
          labelBounds.top > safe.top && labelBounds.bottom < safe.bottom &&
          usedLabels.length < 4
        )) &&
        !protectedAreas.some(rect => overlaps(labelBounds, rect)) &&
        !usedLabels.some(rect => overlaps(labelBounds, rect));
      label.classList.toggle('is-visible', visible);
      if (visible) {
        usedLabels.push(labelBounds);
        label.style.transform = `translate(-50%, -50%) translate3d(${x}px, ${y}px, 0)`;
      }
    }
    if (this.galaxyLabel) {
      const markerVisible = this.mode === 'galaxy' && !this.transitioning && this.showLabels;
      if (markerVisible) {
        this.galaxy.beacon.getWorldPosition(world);
        world.project(this.camera);
        const x = (world.x * .5 + .5) * width;
        const y = (-world.y * .5 + .5) * height;
        const size = this.getLabelSize(this.galaxyLabel, 144, 16);
        const labelBounds = {
          left: x + 12, right: x + 12 + size.width,
          top: y - 24, bottom: y + size.height - 24
        };
        const clear = world.z > -1 && world.z < 1 && x > width * .34 &&
          labelBounds.left > safe.left && labelBounds.right < safe.right &&
          labelBounds.top > safe.top && labelBounds.bottom < safe.bottom &&
          !protectedAreas.some(rect => overlaps(labelBounds, rect));
        this.galaxyLabel.classList.toggle('is-visible', clear);
        if (clear) this.galaxyLabel.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      } else this.galaxyLabel.classList.remove('is-visible');
    }
  }

  updatePerformance(delta) {
    if (delta <= 0 || delta > .5) return;
    this.frameSampleSeconds += delta;
    this.frameSamples += 1;
    if (this.frameSampleSeconds < 1.3) return;
    this.fps = Math.round(this.frameSamples / this.frameSampleSeconds);
    const interval = this.frameSampleSeconds;
    this.frameSampleSeconds = 0;
    this.frameSamples = 0;
    this.performanceSamples.push(this.fps);
    if (this.performanceSamples.length > 180) this.performanceSamples.shift();

    if (this.qualityMode === 'auto') {
      const minFps = this.isCompact ? 26 : 44;
      const recoveredFps = this.isCompact ? 30 : 53;
      this.qualityCooldown = Math.max(0, this.qualityCooldown - interval);
      this.lowFpsDuration = this.fps < minFps ? this.lowFpsDuration + interval : 0;
      this.goodFpsDuration = this.fps >= recoveredFps ? this.goodFpsDuration + interval : 0;
      if (this.qualityCooldown === 0 && this.lowFpsDuration >= 5) {
        if (this.autoQualityTier > 0) {
          this.autoQualityTier--;
          this.applyVisualQuality();
        } else this.adaptiveRatio = Math.max(.62, this.adaptiveRatio - .12);
        this.applyRenderResolution();
        this.lowFpsDuration = 0;
        this.goodFpsDuration = 0;
        this.qualityCooldown = 10;
      } else if (this.qualityCooldown === 0 && this.goodFpsDuration >= 18) {
        if (this.adaptiveRatio < .999) {
          this.adaptiveRatio = Math.min(1, this.adaptiveRatio + .12);
        } else if (this.autoQualityTier < (this.isCompact ? 1 : 2)) {
          this.autoQualityTier++;
          this.applyVisualQuality();
        }
        this.applyRenderResolution();
        this.lowFpsDuration = 0;
        this.goodFpsDuration = 0;
        this.qualityCooldown = 12;
      }
    }
    const snapshot = this.getPerformanceSnapshot();
    this.onTelemetry({ ...snapshot, simulatedDays: this.solar.getSimulationDays() });
  }

  getPerformanceSnapshot() {
    const samples = this.performanceSamples;
    return {
      fps: this.fps,
      averageFps: samples.length ? Math.round(samples.reduce((a, b) => a + b, 0) / samples.length) : this.fps,
      minFps: samples.length ? Math.min(...samples) : this.fps,
      samples: samples.length,
      mode: this.mode,
      qualityMode: this.qualityMode,
      qualityTier: ['省电', '均衡', '精细'][this.visualQualityTier],
      dpr: Number(this.pixelRatio.toFixed(2)),
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures,
      // WebGL renderer.info contains object counts, not GPU memory in bytes.
      gpuMemoryBytes: null
    };
  }

  animate = () => {
    if (!this.pageVisible) return;
    this.animationId = requestAnimationFrame(this.animate);
    const elapsedFrame = this.clock.getDelta();
    const delta = Math.min(elapsedFrame, .05);
    this.elapsed += delta;
    this.galaxy.update(delta, this.elapsed);
    this.starfield.material.uniforms.uTime.value = this.elapsed;
    this.solar.update(delta, this.paused ? 0 : this.timeScale);
    this.updatePerformance(elapsedFrame);
    this.updateFreeMovement(delta);

    if (this.focusFlight) this.updateFocusFlight();
    else if (this.mode === 'planet' && this.focusId && !this.flying && this.lastTrackedPosition) {
      const current = this.solar.bodies[this.focusId].root.getWorldPosition(new THREE.Vector3());
      const difference = current.clone().sub(this.lastTrackedPosition);
      this.camera.position.add(difference);
      this.controls.target.add(difference);
      this.lastTrackedPosition.copy(current);
    }

    if (this.flying) this.camera.lookAt(this.controls.target);
    else this.controls.update();
    if (this.useBloom) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
    // Keep DOM labels in the same rendered frame as their 3D targets.
    this.updateLabels();
    this.frame++;
    if (this.solar.group.visible && this.frame % 22 === 0) {
      this.solar.updateLevelOfDetail(this.camera);
    }
    if (this.frame % 18 === 0) {
      this.onCameraUpdate(this.camera.position.distanceTo(this.controls.target));
    }
  };

  dispose() {
    cancelAnimationFrame(this.animationId);
    this.flightTween?.kill();
    this.reframeTween?.kill();
    this.sceneTimeline?.kill();
    gsap.killTweensOf(this.camera.position);
    gsap.killTweensOf(this.controls.target);
    this.focusFlight = null;
    this.labelResizeObserver?.disconnect();
    window.removeEventListener('resize', this.handleResize);
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    this.controls.dispose();
    this.composer.dispose();
    this.renderer.dispose();
  }
}
