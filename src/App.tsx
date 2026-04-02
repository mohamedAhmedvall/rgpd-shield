import React, { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { 
  Shield, 
  Upload, 
  FileText, 
  Download, 
  CheckCircle2, 
  AlertCircle, 
  Loader2, 
  Eye, 
  EyeOff,
  Search,
  Lock,
  ArrowRight,
  RefreshCw,
  FileCode,
  FileSpreadsheet,
  FileJson,
  Image as ImageIcon,
  Maximize2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { anonymizeDocument, anonymizeMultimodal, AnonymizationResult, PIIEntity } from './services/anonymizer';
import { cn } from './lib/utils';
import { enhanceImageForOCR } from './lib/image-processing';
import * as mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import * as pdfjs from 'pdfjs-dist';
// @ts-ignore - Vite specific import
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Set up PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [content, setContent] = useState<string>('');
  const [base64File, setBase64File] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [result, setResult] = useState<AnonymizationResult | null>(null);
  const [manualRedactions, setManualRedactions] = useState<PIIEntity[]>([]);
  const [showOriginal, setShowOriginal] = useState(false);
  const [highPrecision, setHighPrecision] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isMultimodal, setIsMultimodal] = useState(false);

  const extractText = async (selectedFile: File): Promise<string> => {
    if (selectedFile.size === 0) {
      throw new Error("The file is empty (0 bytes).");
    }
    
    const extension = selectedFile.name.split('.').pop()?.toLowerCase();

    try {
      if (extension === 'pdf') {
        const arrayBuffer = await selectedFile.arrayBuffer();
        const pdf = await pdfjs.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
        let fullText = '';
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();
          const pageText = textContent.items.map((item: any) => item.str).join(' ');
          fullText += pageText + '\n';
        }
        if (!fullText.trim()) {
          throw new Error("No text found in PDF. It might be a scanned image.");
        }
        return fullText;
      } else if (extension === 'docx') {
        const arrayBuffer = await selectedFile.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer });
        if (!result.value.trim()) {
          throw new Error("No text found in DOCX.");
        }
        return result.value;
      } else if (extension === 'xlsx' || extension === 'xls' || extension === 'csv') {
        const arrayBuffer = await selectedFile.arrayBuffer();
        const workbook = XLSX.read(arrayBuffer);
        let fullText = '';
        workbook.SheetNames.forEach(sheetName => {
          const worksheet = workbook.Sheets[sheetName];
          fullText += `--- Sheet: ${sheetName} ---\n`;
          fullText += XLSX.utils.sheet_to_txt(worksheet) + '\n';
        });
        if (!fullText.trim()) {
          throw new Error("No text found in Spreadsheet.");
        }
        return fullText;
      } else {
        // Default for txt, md, json
        const text = await selectedFile.text();
        if (!text.trim()) {
          throw new Error("The text file is empty.");
        }
        return text;
      }
    } catch (err: any) {
      console.error("Extraction error:", err);
      throw new Error(err.message || `Failed to extract text from ${extension?.toUpperCase()} file.`);
    }
  };

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const selectedFile = acceptedFiles[0];
    if (selectedFile) {
      setFile(selectedFile);
      setError(null);
      setResult(null);
      setIsExtracting(true);
      
      const extension = selectedFile.name.split('.').pop()?.toLowerCase();
      const isImage = ['png', 'jpg', 'jpeg', 'webp'].includes(extension || '');
      const isPdf = extension === 'pdf';
      
      try {
        if (isImage || isPdf) {
          setIsMultimodal(true);
          
          // Read file as base64
          const base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve((reader.result as string).split(',')[1]);
            reader.onerror = reject;
            reader.readAsDataURL(selectedFile);
          });

          if (isPdf) {
            // For PDFs, we render the first page to an image for visual preview
            try {
              const arrayBuffer = await selectedFile.arrayBuffer();
              const pdf = await pdfjs.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
              const page = await pdf.getPage(1);
              const viewport = page.getViewport({ scale: 2.0 }); // Higher scale for better OCR
              const canvas = document.createElement('canvas');
              const context = canvas.getContext('2d');
              canvas.height = viewport.height;
              canvas.width = viewport.width;
              if (context) {
                await page.render({ canvasContext: context, viewport }).promise;
                const pdfImageBase64 = canvas.toDataURL('image/jpeg', 0.9).split(',')[1];
                setBase64File(pdfImageBase64);
              }
              
              // Also try to extract text if possible
              try {
                const text = await extractText(selectedFile);
                setContent(text);
              } catch (e) {
                setContent("[Scanned PDF - Will be processed visually]");
              }
            } catch (pdfErr) {
              console.error("PDF processing error:", pdfErr);
              setIsMultimodal(false);
              const text = await extractText(selectedFile);
              setContent(text);
            }
          } else {
            // It's an image
            setBase64File(base64);
            setContent("[Image Content - Will be processed visually]");
          }
        } else {
          setIsMultimodal(false);
          setBase64File(null);
          const text = await extractText(selectedFile);
          setContent(text);
        }
      } catch (err: any) {
        setError(err.message || "Failed to read file");
      } finally {
        setIsExtracting(false);
      }
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'text/plain': ['.txt'],
      'text/markdown': ['.md'],
      'application/json': ['.json'],
      'application/pdf': ['.pdf'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.ms-excel': ['.xls'],
      'text/csv': ['.csv'],
      'image/png': ['.png'],
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/webp': ['.webp']
    },
    multiple: false
  });

  const handleAnonymize = async () => {
    if (!content && !base64File) return;
    
    setIsProcessing(true);
    setError(null);
    try {
      let data: AnonymizationResult;
      
      if (isMultimodal && base64File && file) {
        const mimeType = file.type.startsWith('image/') ? file.type : 'image/jpeg';
        let processedBase64 = base64File;
        
        if (highPrecision) {
          try {
            processedBase64 = await enhanceImageForOCR(base64File, mimeType);
          } catch (e) {
            console.warn("Image enhancement failed, using original", e);
          }
        }
        
        data = await anonymizeMultimodal(
          processedBase64, 
          mimeType, 
          true
        );
      } else {
        // For very large documents, warn the user
        if (content.length > 50000) {
          const proceed = window.confirm("This is a very large document. Processing may take a minute as it will be split into chunks. Continue?");
          if (!proceed) {
            setIsProcessing(false);
            return;
          }
        }
        data = await anonymizeDocument(content);
      }
      setResult(data);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "An error occurred during anonymization. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDownload = (format: 'txt' | 'md' | 'json' = 'txt') => {
    if (!result) return;
    
    let downloadContent = result.anonymizedText;
    let mimeType = 'text/plain';
    let extension = format;

    if (format === 'json') {
      downloadContent = JSON.stringify(result, null, 2);
      mimeType = 'application/json';
    } else if (format === 'md') {
      downloadContent = `# Anonymized Document: ${file?.name}\n\n${result.anonymizedText}`;
      mimeType = 'text/markdown';
    }

    const blob = new Blob([downloadContent], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `anonymized_${file?.name?.split('.')[0] || 'document'}.${extension}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const copyToClipboard = () => {
    if (!result) return;
    navigator.clipboard.writeText(result.anonymizedText);
    // Could add a toast here
  };

  const reset = () => {
    setFile(null);
    setContent('');
    setBase64File(null);
    setResult(null);
    setManualRedactions([]);
    setError(null);
  };

  const removeRedaction = (index: number, isManual: boolean) => {
    if (isManual) {
      setManualRedactions(prev => prev.filter((_, i) => i !== index));
    } else if (result) {
      setResult({
        ...result,
        entities: result.entities.filter((_, i) => i !== index)
      });
    }
  };

  const addManualRedaction = (box: [number, number, number, number]) => {
    const newRedaction: PIIEntity = {
      text: "Manual Redaction",
      type: "MANUAL",
      replacement: "[REDACTED]",
      box_2d: box
    };
    setManualRedactions(prev => [...prev, newRedaction]);
  };

  const downloadRedactedImage = async () => {
    if (!result?.imageData) return;
    
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();
    
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      if (!ctx) return;
      
      ctx.drawImage(img, 0, 0);
      ctx.fillStyle = 'black';
      
      const allRedactions = [...result.entities, ...manualRedactions];
      
      allRedactions.forEach(entity => {
        if (entity.box_2d) {
          const [ymin, xmin, ymax, xmax] = entity.box_2d;
          const x = (xmin / 1000) * canvas.width;
          const y = (ymin / 1000) * canvas.height;
          const w = ((xmax - xmin) / 1000) * canvas.width;
          const h = ((ymax - ymin) / 1000) * canvas.height;
          ctx.fillRect(x, y, w, h);
        }
      });
      
      const link = document.createElement('a');
      link.download = `redacted_${file?.name || 'document.png'}`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    };
    
    img.src = result.imageData;
  };

  const getFileIcon = () => {
    if (!file) return <Upload className="w-8 h-8 text-blue-600" />;
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext === 'pdf') return <FileText className="w-8 h-8 text-red-500" />;
    if (ext === 'docx') return <FileText className="w-8 h-8 text-blue-500" />;
    if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') return <FileSpreadsheet className="w-8 h-8 text-green-600" />;
    if (ext === 'json') return <FileJson className="w-8 h-8 text-yellow-600" />;
    if (['png', 'jpg', 'jpeg', 'webp'].includes(ext || '')) return <ImageIcon className="w-8 h-8 text-purple-600" />;
    return <FileCode className="w-8 h-8 text-slate-600" />;
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-blue-600 p-2 rounded-lg">
              <Shield className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-slate-900">GDPR Shield</h1>
              <p className="text-xs text-slate-500 font-medium uppercase tracking-wider">Enterprise Anonymizer</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden md:flex items-center gap-2 text-sm text-slate-500 bg-slate-100 px-3 py-1.5 rounded-full">
              <Lock className="w-4 h-4" />
              <span>Local Privacy Processing</span>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full p-6 md:p-10">
        <AnimatePresence mode="wait">
          {!result ? (
            <motion.div
              key="upload"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="max-w-3xl mx-auto"
            >
              <div className="text-center mb-10">
                <h2 className="text-3xl font-bold text-slate-900 mb-4">Anonymize your documents instantly</h2>
                <p className="text-slate-600 text-lg">
                  Upload your files to automatically detect and replace sensitive PII data 
                  with secure placeholders. Compliant with GDPR standards.
                </p>
              </div>

              <div
                {...getRootProps()}
                className={cn(
                  "relative border-2 border-dashed rounded-2xl p-12 transition-all duration-200 cursor-pointer flex flex-col items-center justify-center gap-4",
                  isDragActive 
                    ? "border-blue-500 bg-blue-50/50" 
                    : "border-slate-300 hover:border-slate-400 bg-white"
                )}
              >
                <input {...getInputProps()} />
                <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mb-2">
                  {isExtracting ? <Loader2 className="w-8 h-8 text-blue-600 animate-spin" /> : getFileIcon()}
                </div>
                <div className="text-center">
                  <p className="text-lg font-semibold text-slate-900">
                    {file ? file.name : "Click or drag file to upload"}
                  </p>
                  <p className="text-sm text-slate-500 mt-1">
                    Supports PDF, DOCX, XLSX, CSV, TXT, JSON
                  </p>
                </div>
              </div>

              {error && (
                <div className="mt-6 p-4 bg-red-50 border border-red-100 rounded-xl flex items-start gap-3 text-red-800">
                  <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                  <p className="text-sm font-medium">{error}</p>
                </div>
              )}

              <div className="mt-10 flex flex-col items-center gap-6">
                <div className="flex items-center gap-3 bg-white p-3 rounded-xl border border-slate-200 shadow-sm">
                  <div className="flex flex-col">
                    <span className="text-sm font-bold text-slate-900">High Precision Mode</span>
                    <span className="text-[10px] text-slate-500">Enhance scans for better OCR accuracy</span>
                  </div>
                  <button
                    onClick={() => setHighPrecision(!highPrecision)}
                    className={cn(
                      "w-12 h-6 rounded-full transition-colors relative",
                      highPrecision ? "bg-blue-600" : "bg-slate-300"
                    )}
                  >
                    <div className={cn(
                      "absolute top-1 w-4 h-4 bg-white rounded-full transition-all",
                      highPrecision ? "left-7" : "left-1"
                    )} />
                  </button>
                </div>

                <button
                  onClick={handleAnonymize}
                  disabled={!content || isProcessing || isExtracting}
                  className={cn(
                    "px-8 py-4 rounded-xl font-bold text-lg transition-all flex items-center gap-3 shadow-lg",
                    !content || isProcessing || isExtracting
                      ? "bg-slate-200 text-slate-400 cursor-not-allowed"
                      : "bg-blue-600 text-white hover:bg-blue-700 hover:scale-[1.02] active:scale-[0.98]"
                  )}
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="w-6 h-6 animate-spin" />
                      Processing PII...
                    </>
                  ) : (
                    <>
                      <Shield className="w-6 h-6" />
                      Start Anonymization
                    </>
                  )}
                </button>
              </div>

              <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-8">
                {[
                  { icon: Search, title: "Smart Detection", desc: "AI identifies names, emails, addresses, and more." },
                  { icon: Lock, title: "Privacy First", desc: "Data is processed securely and never stored." },
                  { icon: CheckCircle2, title: "GDPR Ready", desc: "Output is sanitized for safe sharing and storage." }
                ].map((feature, i) => (
                  <div key={i} className="flex flex-col items-center text-center">
                    <div className="w-12 h-12 bg-slate-100 rounded-xl flex items-center justify-center mb-4">
                      <feature.icon className="w-6 h-6 text-slate-600" />
                    </div>
                    <h3 className="font-bold text-slate-900 mb-2">{feature.title}</h3>
                    <p className="text-sm text-slate-500 leading-relaxed">{feature.desc}</p>
                  </div>
                ))}
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="result"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="grid grid-cols-1 lg:grid-cols-3 gap-8 h-full"
            >
              {/* Sidebar: Entities Found */}
              <div className="lg:col-span-1 flex flex-col gap-6">
                <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm overflow-hidden flex flex-col h-full max-h-[calc(100vh-200px)]">
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="font-bold text-lg text-slate-900 flex items-center gap-2">
                      <Search className="w-5 h-5 text-blue-600" />
                      PII Detected
                    </h3>
                    <span className="bg-blue-100 text-blue-700 text-xs font-bold px-2 py-1 rounded-full">
                      {result.entities.length} Entities
                    </span>
                  </div>
                  
                  <div className="flex-1 overflow-y-auto pr-2 space-y-3 custom-scrollbar">
                    {/* AI Detected Entities */}
                    {result.entities.map((entity, i) => (
                      <div key={`ai-${i}`} className="p-3 bg-slate-50 rounded-xl border border-slate-100 group hover:border-blue-200 transition-colors relative">
                        <button 
                          onClick={() => removeRedaction(i, false)}
                          className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-red-500 transition-all"
                          title="Remove this redaction"
                        >
                          <RefreshCw className="w-3 h-3" />
                        </button>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{entity.type}</span>
                          <span className="text-[10px] font-mono text-blue-600 font-bold">{entity.replacement}</span>
                        </div>
                        <p className="text-sm font-medium text-slate-700 truncate">{entity.text}</p>
                      </div>
                    ))}
                    
                    {/* Manual Redactions */}
                    {manualRedactions.map((entity, i) => (
                      <div key={`manual-${i}`} className="p-3 bg-amber-50 rounded-xl border border-amber-100 group hover:border-amber-200 transition-colors relative">
                        <button 
                          onClick={() => removeRedaction(i, true)}
                          className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-red-500 transition-all"
                        >
                          <RefreshCw className="w-3 h-3" />
                        </button>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-amber-600">MANUAL</span>
                          <span className="text-[10px] font-mono text-amber-700 font-bold">[REDACTED]</span>
                        </div>
                        <p className="text-sm font-medium text-amber-800 truncate">User defined area</p>
                      </div>
                    ))}
                  </div>

                  <div className="mt-6 pt-6 border-t border-slate-100 space-y-3">
                    {result.imageData && (
                      <button
                        onClick={downloadRedactedImage}
                        className="w-full bg-green-600 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 hover:bg-green-700 transition-colors shadow-sm mb-2"
                      >
                        <Download className="w-5 h-5" />
                        Download Redacted Image
                      </button>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => handleDownload('txt')}
                        className="bg-blue-600 text-white font-bold py-2.5 rounded-xl flex items-center justify-center gap-2 hover:bg-blue-700 transition-colors shadow-sm text-sm"
                      >
                        <Download className="w-4 h-4" />
                        TXT
                      </button>
                      <button
                        onClick={() => handleDownload('md')}
                        className="bg-slate-800 text-white font-bold py-2.5 rounded-xl flex items-center justify-center gap-2 hover:bg-slate-900 transition-colors shadow-sm text-sm"
                      >
                        <FileText className="w-4 h-4" />
                        MD
                      </button>
                    </div>
                    
                    <button
                      onClick={copyToClipboard}
                      className="w-full bg-white border border-slate-200 text-slate-700 font-bold py-3 rounded-xl flex items-center justify-center gap-2 hover:bg-slate-50 transition-colors"
                    >
                      <CheckCircle2 className="w-5 h-5 text-green-500" />
                      Copy Text
                    </button>

                    <button
                      onClick={reset}
                      className="w-full mt-3 text-slate-500 font-bold py-2 rounded-xl flex items-center justify-center gap-2 hover:bg-slate-100 transition-colors text-sm"
                    >
                      <RefreshCw className="w-4 h-4" />
                      New Document
                    </button>
                  </div>
                </div>
              </div>

              {/* Main Content: Document Preview */}
              <div className="lg:col-span-2 flex flex-col gap-6">
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col h-full max-h-[calc(100vh-200px)]">
                  <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <FileText className="w-5 h-5 text-slate-400" />
                      <span className="font-semibold text-slate-700 truncate max-w-[200px]">{file?.name}</span>
                    </div>
                    <div className="flex bg-slate-100 p-1 rounded-lg">
                      <button
                        onClick={() => setShowOriginal(false)}
                        className={cn(
                          "px-4 py-1.5 rounded-md text-sm font-bold transition-all flex items-center gap-2",
                          !showOriginal ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                        )}
                      >
                        <EyeOff className="w-4 h-4" />
                        Anonymized
                      </button>
                      <button
                        onClick={() => setShowOriginal(true)}
                        className={cn(
                          "px-4 py-1.5 rounded-md text-sm font-bold transition-all flex items-center gap-2",
                          showOriginal ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                        )}
                      >
                        <Eye className="w-4 h-4" />
                        Original
                      </button>
                    </div>
                  </div>

                  <div className="flex-1 p-8 overflow-y-auto custom-scrollbar bg-slate-50/30">
                    <div className="prose prose-slate max-w-none">
                      {result.imageData ? (
                        <div className="flex flex-col items-center gap-4">
                          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Visual Redaction Preview</p>
                          <VisualRedaction 
                            imageData={result.imageData} 
                            entities={[...result.entities, ...manualRedactions]} 
                            showOriginal={showOriginal} 
                            onAddManualRedaction={addManualRedaction}
                          />
                          <div className="w-full mt-8 p-6 bg-white rounded-xl border border-slate-100 shadow-sm">
                            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Extracted & Anonymized Text</p>
                            <div className="font-mono text-sm leading-relaxed whitespace-pre-wrap">
                              {result.anonymizedText}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="font-mono text-sm leading-relaxed whitespace-pre-wrap">
                          {showOriginal ? (
                            <HighlightPII text={result.originalText || ''} entities={result.entities} />
                          ) : (
                            result.anonymizedText
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 py-6 px-6">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4 text-slate-400 text-sm">
          <p>© 2026 GDPR Shield AI. All rights reserved.</p>
          <div className="flex items-center gap-6">
            <a href="#" className="hover:text-slate-600 transition-colors">Privacy Policy</a>
            <a href="#" className="hover:text-slate-600 transition-colors">Terms of Service</a>
            <a href="#" className="hover:text-slate-600 transition-colors">Documentation</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

function VisualRedaction({ 
  imageData, 
  entities, 
  showOriginal, 
  onAddManualRedaction 
}: { 
  imageData: string, 
  entities: PIIEntity[], 
  showOriginal: boolean,
  onAddManualRedaction: (box: [number, number, number, number]) => void
}) {
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPos, setStartPos] = useState<{x: number, y: number} | null>(null);
  const [currentBox, setCurrentBox] = useState<{x: number, y: number, w: number, h: number} | null>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (showOriginal || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 1000;
    const y = ((e.clientY - rect.top) / rect.height) * 1000;
    setStartPos({ x, y });
    setIsDrawing(true);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDrawing || !startPos || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 1000;
    const y = ((e.clientY - rect.top) / rect.height) * 1000;
    
    setCurrentBox({
      x: Math.min(startPos.x, x),
      y: Math.min(startPos.y, y),
      w: Math.abs(x - startPos.x),
      h: Math.abs(y - startPos.y)
    });
  };

  const handleMouseUp = () => {
    if (isDrawing && currentBox && currentBox.w > 5 && currentBox.h > 5) {
      onAddManualRedaction([
        currentBox.y,
        currentBox.x,
        currentBox.y + currentBox.h,
        currentBox.x + currentBox.w
      ]);
    }
    setIsDrawing(false);
    setStartPos(null);
    setCurrentBox(null);
  };

  return (
    <div className="flex flex-col items-center">
      {!showOriginal && (
        <p className="text-[10px] text-slate-400 mb-2 font-bold uppercase tracking-widest flex items-center gap-2">
          <Maximize2 className="w-3 h-3" />
          Click and drag on the image to add manual redactions
        </p>
      )}
      <div 
        ref={containerRef}
        className={cn(
          "relative inline-block rounded-lg overflow-hidden shadow-2xl border border-slate-200",
          !showOriginal && "cursor-crosshair"
        )}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <img 
          src={imageData} 
          alt="Original Document" 
          className="max-w-full h-auto block select-none"
          referrerPolicy="no-referrer"
          draggable={false}
        />
        
        {/* Drawing Box */}
        {currentBox && (
          <div 
            className="absolute border-2 border-blue-500 bg-blue-500/30 pointer-events-none"
            style={{
              top: `${currentBox.y / 10}%`,
              left: `${currentBox.x / 10}%`,
              height: `${currentBox.h / 10}%`,
              width: `${currentBox.w / 10}%`,
            }}
          />
        )}

        {!showOriginal && entities.map((entity, i) => {
          if (!entity.box_2d) return null;
          const [ymin, xmin, ymax, xmax] = entity.box_2d;
          return (
            <div 
              key={i}
              className={cn(
                "absolute transition-opacity duration-300",
                entity.type === 'MANUAL' ? "bg-black/80 border border-amber-500/50" : "bg-black"
              )}
              style={{
                top: `${ymin / 10}%`,
                left: `${xmin / 10}%`,
                height: `${(ymax - ymin) / 10}%`,
                width: `${(xmax - xmin) / 10}%`,
                opacity: 1
              }}
              title={`${entity.type}: ${entity.text}`}
            />
          );
        })}
        {/* Overlay for labels if showing original */}
        {showOriginal && entities.map((entity, i) => {
          if (!entity.box_2d) return null;
          const [ymin, xmin, ymax, xmax] = entity.box_2d;
          return (
            <div 
              key={i}
              className="absolute border-2 border-red-500 bg-red-500/20 transition-opacity duration-300 group"
              style={{
                top: `${ymin / 10}%`,
                left: `${xmin / 10}%`,
                height: `${(ymax - ymin) / 10}%`,
                width: `${(xmax - xmin) / 10}%`,
              }}
            >
              <span className="absolute -top-6 left-0 bg-red-500 text-white text-[10px] font-bold px-1 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity">
                {entity.type}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HighlightPII({ text, entities }: { text: string, entities: any[] }) {
  const sortedEntities = [...entities].sort((a, b) => b.text.length - a.text.length);
  let highlighted = text;
  const placeholders: string[] = [];
  
  sortedEntities.forEach((entity, i) => {
    const placeholder = `__PII_${i}__`;
    placeholders.push(placeholder);
    const escapedText = entity.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    highlighted = highlighted.replace(new RegExp(escapedText, 'g'), placeholder);
  });

  const parts = highlighted.split(/(__PII_\d+__)/);

  return (
    <>
      {parts.map((part, i) => {
        const match = part.match(/__PII_(\d+)__/);
        if (match) {
          const index = parseInt(match[1]);
          return (
            <span key={i} className="pii-highlight" title={sortedEntities[index].type}>
              {sortedEntities[index].text}
            </span>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

