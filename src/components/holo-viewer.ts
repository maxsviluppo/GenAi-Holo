import { Component, ElementRef, input, effect, viewChild, OnDestroy } from '@angular/core';
import * as THREE from 'three';

@Component({
  selector: 'app-holo-viewer',
  standalone: true,
  template: `<div #container class="w-full h-full min-h-[150px]"></div>`,
  styles: [`
    :host { display: block; width: 100%; height: 100%; overflow: hidden; }
    div { width: 100%; height: 100%; }
  `]
})
export class HoloViewer implements OnDestroy {
  data = input<any>();
  animate = input<boolean>(false);
  container = viewChild<ElementRef<HTMLDivElement>>('container');

  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private clock = new THREE.Clock();
  private requestRef?: number;
  private group = new THREE.Group();

  constructor() {
    effect(() => {
      const containerEl = this.container()?.nativeElement;
      if (containerEl) {
        this.initThree(containerEl);
      }
    });

    effect(() => {
      const dna = this.data();
      if (dna) {
        this.updateDNA(dna);
      }
    });
  }

  private initThree(container: HTMLDivElement) {
    // Clear existing
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }

    this.scene = new THREE.Scene();
    this.scene.background = null; // Transparent

    const width = container.clientWidth || 300;
    const height = container.clientHeight || 300;

    this.camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
    this.camera.position.z = 5;

    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      this.renderer.setSize(width, height);
      this.renderer.setPixelRatio(window.devicePixelRatio);
      container.appendChild(this.renderer.domElement);
    } catch (e) {
      console.error('WebGL not supported', e);
      return;
    }

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    this.scene.add(ambientLight);

    const pointLight = new THREE.PointLight(0xffffff, 1.5);
    pointLight.position.set(5, 5, 5);
    this.scene.add(pointLight);

    this.scene.add(this.group);

    const animateFn = () => {
      this.requestRef = requestAnimationFrame(animateFn);
      
      if (this.animate()) {
        this.group.rotation.y += 0.015;
      }

      if (this.renderer && this.scene && this.camera) {
        this.renderer.render(this.scene, this.camera);
      }
    };

    if (this.requestRef) cancelAnimationFrame(this.requestRef);
    animateFn();

    // Resize observer
    const observer = new ResizeObserver(() => {
      if (!this.renderer || !this.camera) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      this.renderer.setSize(w, h);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    });
    observer.observe(container);
  }

  private updateDNA(dna: any) {
    if (!this.group) return;

    // Clear previous group children
    while (this.group.children.length > 0) {
      const child = this.group.children[0];
      if (child instanceof THREE.Mesh) {
         child.geometry.dispose();
         if (Array.isArray(child.material)) {
           child.material.forEach(m => m.dispose());
         } else {
           child.material.dispose();
         }
      }
      this.group.remove(child);
    }

    if (!dna || !dna.parts || !Array.isArray(dna.parts)) return;

    dna.parts.forEach((part: any) => {
      let geometry: THREE.BufferGeometry;
      switch (part.type) {
        case 'sphere': geometry = new THREE.SphereGeometry(1, 16, 16); break;
        case 'cylinder': geometry = new THREE.CylinderGeometry(1, 1, 1, 16); break;
        case 'cone': geometry = new THREE.ConeGeometry(1, 1, 16); break;
        case 'torus': geometry = new THREE.TorusGeometry(1, 0.4, 8, 32); break;
        default: geometry = new THREE.BoxGeometry(1, 1, 1);
      }

      const material = new THREE.MeshPhongMaterial({ 
        color: part.color || dna.colorTheme || '#00f3ff',
        transparent: true,
        opacity: 0.85,
        shininess: 100
      });

      const mesh = new THREE.Mesh(geometry, material);
      
      if (part.pos) mesh.position.set(part.pos[0], part.pos[1], part.pos[2]);
      if (part.rot) mesh.rotation.set(part.rot[0], part.rot[1], part.rot[2]);
      if (part.scale) mesh.scale.set(part.scale[0], part.scale[1], part.scale[2]);

      this.group.add(mesh);
    });

    // Auto-center camera/scale
    const box = new THREE.Box3().setFromObject(this.group);
    if (!box.isEmpty()) {
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      
      this.group.position.set(-center.x, -center.y, -center.z);
      if (this.camera) {
        this.camera.position.z = Math.max(5, maxDim * 2.5);
      }
    }
  }

  ngOnDestroy() {
    if (this.requestRef) cancelAnimationFrame(this.requestRef);
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer.forceContextLoss();
    }
  }
}
