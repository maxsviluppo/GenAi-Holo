import { Component, inject, signal, computed, effect, ViewChild, ElementRef, SecurityContext, HostListener } from '@angular/core';
import { CommonModule, NgOptimizedImage } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HoloViewer } from './components/holo-viewer';
import { GeminiService } from './services/gemini.service';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';

// --- Interfaces ---
interface SubjectModel {
  id: string;
  name: string; // Nome definito dall'utente
  prompt: string; // Il prompt usato o la descrizione dell'immagine caricata
  imageUrl: string; // Rappresentazione Base64 (o placeholder per 3D)
  createdAt: number;
  is3D?: boolean;
  threeData?: any; // Structured JSON for 3D rendering
}

interface Project {
  id: string;
  type: 'image' | 'video';
  subjectIds: string[];
  scenePrompt: string;
  resultUrl: string | SafeUrl; 
  createdAt: number;
  status: 'generating' | 'completed' | 'failed';
  aspectRatio: string;
  effectName?: string; // Track which effect was used
}

interface EffectOption {
  id: string;
  label: string;
  icon: string;
  prompt: string;
}

interface SceneLayer {
  id: string;       // Unique layer ID
  subjectId: string;
  x: number;        // Percentage (0-100)
  y: number;        // Percentage (0-100)
  scale: number;    // Scale factor (0.5 - 3.0)
  zIndex: number;
}

interface Notification {
  id: string;
  message: string;
  type: 'error' | 'success' | 'info';
}

@Component({
  selector: 'app-root',
  imports: [CommonModule, FormsModule, HoloViewer],
  templateUrl: './app.component.html',
  styleUrls: [] 
})
export class AppComponent {
  private gemini = inject(GeminiService);
  private sanitizer = inject(DomSanitizer);

  // --- State Signals ---
  activeTab = signal<'lab' | 'gallery' | 'studio' | 'showcase' | 'info'>('lab');
  apiKey = signal(localStorage.getItem('GEMINI_API_KEY') || '');
  
  // Data
  subjects = signal<SubjectModel[]>([]);
  projects = signal<Project[]>([]);
  
  // Selection (Multiple)
  selectedSubjectIds = signal<Set<string>>(new Set());
  
  // Computed Helpers
  selectedSubjects = computed(() => {
    const ids = this.selectedSubjectIds();
    return this.subjects().filter(s => ids.has(s.id));
  });

  // Il primo soggetto selezionato è il "Primary" per i riferimenti video
  primarySubject = computed(() => this.selectedSubjects()[0] || null);
  
  // Inputs
  creationMode = signal<'2d' | '3d'>('2d');
  newSubjectName = signal('');
  newSubjectPrompt = signal('');
  newProjectPrompt = signal('');
  isGenerating = signal(false);
  generationStatus = signal<string>('');
  
  // 3D Preview State
  preview3DData = signal<any>(null);
  
  // Aspect Ratio Settings
  availableAspectRatios = ['1:1', '16:9', '9:16', '4:3', '3:4'];
  selectedAspectRatio = signal<string>('16:9');

  // --- Visual Effects Configuration ---
  
  imageEffects: EffectOption[] = [
    { id: 'none', label: 'Nessuno', icon: 'fa-ban', prompt: '' },
    { id: 'fog', label: 'Nebbia Volumetrica', icon: 'fa-cloud', prompt: 'Atmospheric heavy fog, mysterious volumetric lighting, haze, depth, cinematic atmosphere' },
    { id: 'smoke', label: 'Fumo Denso', icon: 'fa-smog', prompt: 'Thick swirling smoke, dramatic shadows, high contrast, dark atmosphere' },
    { id: 'laser', label: 'Luci Laser', icon: 'fa-bolt', prompt: 'Neon laser beams cutting through darkness, cyberpunk aesthetic, vibrant glowing lines, sci-fi club atmosphere' },
    { id: 'pointnclick', label: 'Punta & Clicca 90s', icon: 'fa-computer-mouse', prompt: 'Retro 90s point and click adventure game style, pixel art aesthetic, VGA color palette, dithered shading' },
    { id: 'noir', label: 'Film Noir', icon: 'fa-hat-cowboy', prompt: 'Black and white photography, high contrast, film grain, dramatic shadows, detective movie style' },
    { id: 'hologram', label: 'Ologramma', icon: 'fa-ghost', prompt: 'Translucent holographic projection style, scanlines, digital interference, blue glowing edges' }
  ];

  videoEffects: EffectOption[] = [
    { id: 'none', label: 'Nessuno', icon: 'fa-ban', prompt: '' },
    { id: 'vhs', label: 'VHS Glitch', icon: 'fa-tape', prompt: 'Analog video aesthetic, VHS tracking error, chromatic aberration, low fidelity 90s footage, magnetic tape distortion' },
    { id: 'glow', label: 'Dreamy Glow', icon: 'fa-sun', prompt: 'Soft focus, intense bloom effect, ethereal lighting, dream sequence, angelic aura' },
    { id: 'cyber', label: 'Cyber Glitch', icon: 'fa-microchip', prompt: 'Digital video corruption, datamoshing, pixel sorting artifacts, cyberpunk glitch art, stuttering visual data' },
    { id: 'matrix', label: 'Digital Rain', icon: 'fa-code', prompt: 'Green digital code overlay, sci-fi matrix atmosphere, streaming data visualization' }
  ];

  selectedImageEffect = signal<EffectOption>(this.imageEffects[0]);
  selectedVideoEffect = signal<EffectOption>(this.videoEffects[0]);

  // Computed helper for the canvas preview
  activeEffectId = computed(() => {
    if (this.selectedImageEffect().id !== 'none') return this.selectedImageEffect().id;
    if (this.selectedVideoEffect().id !== 'none') return this.selectedVideoEffect().id;
    return 'none';
  });

  // Upload Handling
  uploadedImageBase64 = signal<string | null>(null);

  // Fullscreen Modal State
  selectedProject = signal<Project | null>(null);
  
  // Edit Mode State - Stores the entire project being referenced
  editingProject = signal<Project | null>(null);

  // --- Scene Editor (Canvas) State ---
  isCanvasMode = signal(false);
  sceneLayers = signal<SceneLayer[]>([]);
  selectedLayerId = signal<string | null>(null);
  
  // Dragging State
  private isDragging = false;
  private dragStart = { x: 0, y: 0 };
  private activeLayerStart = { x: 0, y: 0 }; // Percentage
  
  @ViewChild('sceneCanvas') sceneCanvasRef!: ElementRef<HTMLDivElement>;
  
  // --- NOTIFICATION SYSTEM ---
  notifications = signal<Notification[]>([]);

  // --- Computed ---
  sortedSubjects = computed(() => [...this.subjects()].sort((a, b) => b.createdAt - a.createdAt));
  sortedProjects = computed(() => [...this.projects()].sort((a, b) => b.createdAt - a.createdAt));
  
  activeLayer = computed(() => {
    const id = this.selectedLayerId();
    if (!id) return null;
    return this.sceneLayers().find(l => l.id === id) || null;
  });

  constructor() {
    // Load data
    const savedSubjects = localStorage.getItem('holo_lab_subjects_v2');
    if (savedSubjects) {
      this.subjects.set(JSON.parse(savedSubjects));
    }
    const savedProjects = localStorage.getItem('holo_lab_projects_v2');
    if (savedProjects) {
       // Note: In a real app we'd need to re-sanitize or handle URLs better
    }
    
    // Auto-save effect
    effect(() => {
      localStorage.setItem('holo_lab_subjects_v2', JSON.stringify(this.subjects()));
    });
  }
  
  onApiKeyChange(val: string) {
    this.apiKey.set(val);
    this.gemini.updateApiKey(val);
  }

  // --- Actions: Notification ---
  addNotification(message: string, type: 'error' | 'success' | 'info', duration: number = 7000) {
    const id = crypto.randomUUID();
    this.notifications.update(current => [...current, { id, message, type }]);
    setTimeout(() => {
      this.removeNotification(id);
    }, duration);
  }

  removeNotification(id: string) {
    this.notifications.update(current => current.filter(n => n.id !== id));
  }


  // --- Actions: Navigation ---
  setView(view: 'lab' | 'gallery' | 'studio' | 'showcase' | 'info') {
    this.activeTab.set(view);
  }

  // --- Actions: Selection ---
  toggleSubject(id: string) {
    this.selectedSubjectIds.update(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }
  
  clearSelection() {
    this.selectedSubjectIds.set(new Set());
  }

  deleteSubject(id: string, event: Event) {
    event.stopPropagation();
    if(confirm('Eliminare definitivamente questo modello?')) {
      this.subjects.update(prev => prev.filter(s => s.id !== id));
      this.selectedSubjectIds.update(prev => {
         const next = new Set(prev);
         next.delete(id);
         return next;
      });
    }
  }

  // --- Actions: File Upload ---
  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const file = input.files[0];
      const reader = new FileReader();
      reader.onload = (e: any) => {
        this.uploadedImageBase64.set(e.target.result);
        // Suggerimento automatico per il nome se vuoto
        if (!this.newSubjectName()) {
            this.newSubjectName.set(file.name.split('.')[0]);
        }
      };
      reader.readAsDataURL(file);
    }
  }

  clearUpload() {
    this.uploadedImageBase64.set(null);
  }

  // --- Actions: Creation & Analysis ---

  private handleGeminiError(err: any): string {
    const errorStr = JSON.stringify(err || {});
    if (errorStr.includes('429') || errorStr.includes('RESOURCE_EXHAUSTED') || errorStr.includes('quota')) {
      return "Quota Google esaurita (Limite RPM/Giorno). Attendi 1-2 minuti e riprova. Se persiste, la quota giornaliera è terminata.";
    }
    return 'Errore Inaspettato: ' + (err?.message || 'Controlla la console per i dettagli.');
  }

  async analyzeSubject() {
    if (!this.uploadedImageBase64() && !this.newSubjectPrompt()) return;
    
    this.isGenerating.set(true);
    this.generationStatus.set('Gemini 2.5 Flash: Scansione Elementi Visivi...');

    try {
      const extractedPrompt = await this.gemini.refineCharacterPrompt(
        this.uploadedImageBase64(), 
        this.newSubjectPrompt()
      );
      this.newSubjectPrompt.set(extractedPrompt);
      this.generationStatus.set('Analisi Completata.');
      this.addNotification('Analisi del soggetto completata con successo!', 'success', 3000);
    } catch (err) {
      this.addNotification(this.handleGeminiError(err), 'error');
    } finally {
      this.isGenerating.set(false);
      setTimeout(() => this.generationStatus.set(''), 2000);
    }
  }

  async preview3D() {
    if (!this.newSubjectPrompt()) {
      this.addNotification('Inserisci una descrizione per il Forge 3D.', 'info');
      return;
    }

    this.isGenerating.set(true);
    this.generationStatus.set('Forgiatura DNA 3D in corso...');

    try {
      const dnaStr = await this.gemini.generate3DSubjectMeta(this.newSubjectPrompt());
      const dna = JSON.parse(dnaStr);
      this.preview3DData.set(dna);
      
      if (dna.name && !this.newSubjectName()) {
        this.newSubjectName.set(dna.name);
      }
      this.addNotification('DNA 3D forgiato con successo!', 'success');
    } catch (err) {
      this.addNotification(this.handleGeminiError(err), 'error');
    } finally {
      this.isGenerating.set(false);
      this.generationStatus.set('');
    }
  }

  async create3DSubject() {
    if (!this.preview3DData()) {
      await this.preview3D();
      if (!this.preview3DData()) return;
    }

    const dna = this.preview3DData();
    const newSubject: SubjectModel = {
      id: crypto.randomUUID(),
      name: this.newSubjectName() || dna.name || 'Soggetto 3D',
      prompt: this.newSubjectPrompt(),
      imageUrl: '', // 3D models don't have a static image yet, maybe a placeholder
      createdAt: Date.now(),
      is3D: true,
      threeData: dna
    };

    this.subjects.update(prev => [newSubject, ...prev]);
    
    this.newSubjectName.set('');
    this.newSubjectPrompt.set('');
    this.preview3DData.set(null);
    
    this.toggleSubject(newSubject.id);
    this.setView('gallery');
    this.addNotification(`Entità 3D "${newSubject.name}" stabilizzata e aggiunta al cast!`, 'success');
  }

  async createSubject() {
    if (!this.newSubjectName()) {
      this.addNotification('Il "Nome in Codice" è obbligatorio.', 'error');
      return;
    }
    if (!this.uploadedImageBase64() && !this.newSubjectPrompt()){
      this.addNotification('Devi caricare un\'immagine o fornire delle specifiche visive.', 'error');
      return;
    }
    
    this.isGenerating.set(true);
    this.generationStatus.set('Salvataggio Modello...');

    try {
      let imageUrl = '';
      if (this.uploadedImageBase64()) {
         imageUrl = this.uploadedImageBase64()!;
      } else {
         this.generationStatus.set('Generazione Anteprima Asset...');
         imageUrl = await this.gemini.generateSubjectModel(this.newSubjectPrompt());
      }
      
      let finalPrompt = this.newSubjectPrompt();
      if (!finalPrompt && this.uploadedImageBase64()) {
         this.generationStatus.set('Auto-Tagging con Flash...');
         finalPrompt = await this.gemini.refineCharacterPrompt(this.uploadedImageBase64(), "");
      }
      
      const newSubject: SubjectModel = {
        id: crypto.randomUUID(),
        name: this.newSubjectName(),
        prompt: finalPrompt,
        imageUrl: imageUrl,
        createdAt: Date.now()
      };

      this.subjects.update(prev => [newSubject, ...prev]);
      
      this.newSubjectName.set('');
      this.newSubjectPrompt.set('');
      this.uploadedImageBase64.set(null);
      
      this.toggleSubject(newSubject.id);
      this.setView('gallery');
      this.addNotification(`Modello "${newSubject.name}" creato e aggiunto al cast!`, 'success');
    } catch (err) {
      this.addNotification(this.handleGeminiError(err), 'error');
    } finally {
      this.isGenerating.set(false);
      this.generationStatus.set('');
    }
  }

  // --- SCENE EDITOR LOGIC ---

  toggleCanvasMode() {
    this.isCanvasMode.update(v => !v);
  }

  addToScene(subject: SubjectModel) {
    // Find Max Z
    const maxZ = this.sceneLayers().reduce((max, layer) => Math.max(max, layer.zIndex), 0);
    
    const newLayer: SceneLayer = {
      id: crypto.randomUUID(),
      subjectId: subject.id,
      x: 50, // Center
      y: 50, // Center
      scale: 1,
      zIndex: maxZ + 1
    };
    this.sceneLayers.update(prev => [...prev, newLayer]);
    this.selectedLayerId.set(newLayer.id);
  }

  removeLayer(layerId: string) {
    this.sceneLayers.update(prev => prev.filter(l => l.id !== layerId));
    if (this.selectedLayerId() === layerId) {
      this.selectedLayerId.set(null);
    }
  }

  selectLayer(layerId: string, event?: Event) {
    if (event) event.stopPropagation();
    this.selectedLayerId.set(layerId);
    // Removed auto-bring-to-front to allow precise layering without disrupting composition
  }

  changeZIndex(action: 'front' | 'back') {
      const id = this.selectedLayerId();
      if (!id) return;

      this.sceneLayers.update(layers => {
          const currentLayer = layers.find(l => l.id === id);
          if (!currentLayer) return layers;

          const otherLayers = layers.filter(l => l.id !== id);
          let newZ = currentLayer.zIndex;

          if (action === 'front') {
              const maxZ = Math.max(...otherLayers.map(l => l.zIndex), 0);
              newZ = maxZ + 1;
          } else {
              const minZ = Math.min(...otherLayers.map(l => l.zIndex), 0);
              newZ = Math.max(0, minZ - 1); // Avoid negative
          }

          return layers.map(l => l.id === id ? { ...l, zIndex: newZ } : l);
      });
  }

  updateLayerScale(val: number) {
    const id = this.selectedLayerId();
    if (!id) return;
    this.sceneLayers.update(layers => layers.map(l => l.id === id ? { ...l, scale: val } : l));
  }

  // --- Drag & Drop Implementation ---
  
  onCanvasMouseDown(event: MouseEvent, layer: SceneLayer) {
    event.preventDefault();
    event.stopPropagation();
    this.selectLayer(layer.id);
    this.isDragging = true;
    this.dragStart = { x: event.clientX, y: event.clientY };
    this.activeLayerStart = { x: layer.x, y: layer.y };
  }

  @HostListener('window:mousemove', ['$event'])
  onWindowMouseMove(event: MouseEvent) {
    if (!this.isDragging || !this.selectedLayerId() || !this.sceneCanvasRef) return;

    const canvasRect = this.sceneCanvasRef.nativeElement.getBoundingClientRect();
    const deltaX = event.clientX - this.dragStart.x;
    const deltaY = event.clientY - this.dragStart.y;

    const percentX = (deltaX / canvasRect.width) * 100;
    const percentY = (deltaY / canvasRect.height) * 100;

    const newX = this.activeLayerStart.x + percentX;
    const newY = this.activeLayerStart.y + percentY;

    const clampedX = Math.max(-20, Math.min(120, newX));
    const clampedY = Math.max(-20, Math.min(120, newY));

    this.sceneLayers.update(layers => 
      layers.map(l => l.id === this.selectedLayerId() ? { ...l, x: clampedX, y: clampedY } : l)
    );
  }

  @HostListener('window:mouseup')
  onWindowMouseUp() {
    this.isDragging = false;
  }
  
  onLayerWheel(event: WheelEvent, layerId: string) {
    if (this.selectedLayerId() !== layerId) return;
    event.preventDefault();
    const delta = event.deltaY > 0 ? -0.1 : 0.1;
    this.sceneLayers.update(layers => 
      layers.map(l => {
        if (l.id === layerId) {
          const newScale = Math.max(0.2, Math.min(5, l.scale + delta));
          return { ...l, scale: newScale };
        }
        return l;
      })
    );
  }

  // --- Generation Logic Update ---

  getLayerLabel(layer: SceneLayer): string {
    const hPos = layer.x < 33 ? 'Sinistra' : layer.x > 66 ? 'Destra' : 'Centro';
    const vPos = layer.y < 33 ? 'Alto' : layer.y > 66 ? 'Basso' : 'Centro';
    
    return `${vPos} ${hPos} (z:${layer.zIndex})`;
  }

  generateSpatialPrompt(): string {
    const layers = this.sceneLayers();
    if (layers.length === 0) return "";

    const descriptions: string[] = [];
    
    const sortedByZ = [...layers].sort((a, b) => a.zIndex - b.zIndex);
    const minZ = sortedByZ.length > 0 ? sortedByZ[0].zIndex : 0;
    const maxZ = sortedByZ.length > 0 ? sortedByZ[sortedByZ.length - 1].zIndex : 0;

    sortedByZ.forEach(layer => {
      const subject = this.subjects().find(s => s.id === layer.subjectId);
      if (!subject) return;

      let position = "";
      
      if (layer.x < 30) position += "FAR LEFT";
      else if (layer.x < 45) position += "MID-LEFT";
      else if (layer.x > 70) position += "FAR RIGHT";
      else if (layer.x > 55) position += "MID-RIGHT";
      else position += "CENTER";

      if (layer.y < 30) position += ", TOP";
      else if (layer.y > 70) position += ", BOTTOM";
      
      if (layer.zIndex === minZ && layers.length > 1) position += ", BACKGROUND layer";
      else if (layer.zIndex === maxZ && layers.length > 1) position += ", FOREGROUND layer (closest to camera)";
      
      if (layer.scale < 0.6) position += " (appears SMALL/DISTANT)";
      else if (layer.scale > 1.3) position += " (appears LARGE/CLOSE-UP)";

      descriptions.push(`- [LAYER Z:${layer.zIndex}] SUBJECT: ${subject.name} | POSITION: ${position} | VISUALS: ${subject.prompt}`);
    });

    return `\n\nSTRICT COMPOSITION & DEPTH LAYOUT (Render strictly in this order):\n${descriptions.join('\n')}\nEnsure foreground layers occlude background layers naturally.`;
  }

  async createProject(type: 'image' | 'video') {
    let squad = this.selectedSubjects();
    let prompt = this.newProjectPrompt();
    const ratio = this.selectedAspectRatio();
    let spatialPrompt = "";
    
    if (this.isCanvasMode() && this.sceneLayers().length > 0) {
        spatialPrompt = this.generateSpatialPrompt();
        const layerSubjectIds = new Set(this.sceneLayers().map(l => l.subjectId));
        squad = this.subjects().filter(s => layerSubjectIds.has(s.id));
    }
    
    if (squad.length === 0) {
        this.addNotification('Devi prima selezionare almeno un attore dal Cast.', 'error');
        return;
    }
    if (!prompt) {
        this.addNotification('Il prompt di scena è obbligatorio per descrivere l\'ambiente.', 'error');
        return;
    }

    this.isGenerating.set(true);
    
    const projectId = crypto.randomUUID();
    const subjectIds = squad.map(s => s.id);
    
    let effectPrompt = "";
    let effectNameLabel = "";
    
    if (type === 'image') {
       effectPrompt = this.selectedImageEffect().prompt;
       effectNameLabel = this.selectedImageEffect().label;
    } else {
       effectPrompt = this.selectedVideoEffect().prompt;
       effectNameLabel = this.selectedVideoEffect().label;
    }

    let fullPrompt = "";
    
    if (this.isCanvasMode()) {
         fullPrompt = `${spatialPrompt}\n\nSCENE ENVIRONMENT / CONTEXT:\n${prompt}`;
    } else {
        if (squad.length === 1) {
            fullPrompt = `Character Reference Description: ${squad[0].prompt}. \n\nTarget Scene: ${prompt}.`;
        } else {
            const charDescriptions = squad.map((s, i) => `[Character ${i+1} (${s.name}) Visual Data: ${s.prompt}]`).join("\n");
            fullPrompt = `Scene with multiple characters:\n${charDescriptions}\n\nTarget Scene Description: ${prompt}.\nEnsure coherent interaction based on Visual Data provided.`;
        }
    }

    if (effectPrompt) {
        fullPrompt += `\n\nVISUAL STYLE / POST-PROCESSING INSTRUCTIONS: Apply the following style strictly: ${effectPrompt}.`;
    }

    const newProject: Project = {
      id: projectId,
      type,
      subjectIds: subjectIds,
      scenePrompt: prompt,
      resultUrl: '',
      createdAt: Date.now(),
      status: 'generating',
      aspectRatio: ratio,
      effectName: effectNameLabel !== 'Nessuno' ? effectNameLabel : undefined
    };
    
    this.projects.update(prev => [newProject, ...prev]);
    this.editingProject.set(null);
    this.setView('showcase'); 

    try {
      if (type === 'video') {
        this.generationStatus.set(`Veo 2.0: Generazione Clip (${ratio}) + FX...`);
        const primary = squad[0]; 
        if (!primary) throw new Error("Nessun soggetto primario trovato.");

        const videoPrompt = `${fullPrompt} (Output aspect ratio: ${ratio}, Cinematic, High Quality)`;
        const videoUrl = await this.gemini.generateSceneVideo(primary.imageUrl, videoPrompt);
        const safeUrl = this.sanitizer.bypassSecurityTrustUrl(videoUrl);
        this.updateProjectStatus(projectId, 'completed', safeUrl);
      } else {
        this.generationStatus.set(`Imagen 4.0: Rendering Scena (${ratio}) + FX...`);
        const imageUrl = await this.gemini.generateSceneImage(fullPrompt, ratio);
        this.updateProjectStatus(projectId, 'completed', imageUrl);
      }
      this.addNotification(`Progetto "${type === 'image' ? 'Immagine' : 'Video'}" generato con successo!`, 'success');
    } catch (err) {
      console.error(err);
      this.updateProjectStatus(projectId, 'failed', '');
      this.addNotification(this.handleGeminiError(err), 'error');
    } finally {
      this.isGenerating.set(false);
      this.generationStatus.set('');
      this.newProjectPrompt.set('');
    }
  }

  updateProjectStatus(id: string, status: 'completed' | 'failed', resultUrl: string | SafeUrl) {
    this.projects.update(prev => prev.map(p => 
      p.id === id ? { ...p, status, resultUrl } : p
    ));
  }
  
  remixProject(project: Project, event: Event) {
    event.stopPropagation();
    
    this.editingProject.set(project);
    this.selectedSubjectIds.set(new Set(project.subjectIds));
    this.newProjectPrompt.set(project.scenePrompt);
    
    if (project.aspectRatio) {
      this.selectedAspectRatio.set(project.aspectRatio);
    }
    
    this.selectedImageEffect.set(this.imageEffects[0]);
    this.selectedVideoEffect.set(this.videoEffects[0]);
    this.isCanvasMode.set(false);
    this.sceneLayers.set([]);
    this.setView('studio');
  }

  cancelEdit() {
    this.editingProject.set(null);
    this.newProjectPrompt.set('');
    this.selectedAspectRatio.set('16:9');
    this.isCanvasMode.set(false);
  }

  deleteProject(id: string, event: Event) {
    event.stopPropagation();
    if (confirm("Sei sicuro di voler eliminare questa scena dall'archivio?")) {
      this.projects.update(prev => prev.filter(p => p.id !== id));
      if (this.selectedProject()?.id === id) {
        this.closeFullscreen();
      }
    }
  }

  openFullscreen(project: Project) {
    if (project.status === 'completed') {
      this.selectedProject.set(project);
    }
  }

  closeFullscreen() {
    this.selectedProject.set(null);
  }

  getProjectSubjectNames(subjectIds: string[]): string {
    return subjectIds
      .map(id => this.subjects().find(s => s.id === id)?.name || 'Sconosciuto')
      .join(', ');
  }
  
  getSafeUrl(url: string | SafeUrl): SafeUrl {
    if (typeof url !== 'string') return url;
    return this.sanitizer.bypassSecurityTrustResourceUrl(url);
  }
  
  setAspectRatio(ratio: string) {
    this.selectedAspectRatio.set(ratio);
  }

  setImageEffect(effect: EffectOption) {
    if (effect.id !== 'none') {
      this.selectedVideoEffect.set(this.videoEffects[0]); 
    }
    this.selectedImageEffect.set(effect);
  }

  setVideoEffect(effect: EffectOption) {
    if (effect.id !== 'none') {
      this.selectedImageEffect.set(this.imageEffects[0]);
    }
    this.selectedVideoEffect.set(effect);
  }
  
  getSubjectById(id: string) {
      return this.subjects().find(s => s.id === id);
  }
}
