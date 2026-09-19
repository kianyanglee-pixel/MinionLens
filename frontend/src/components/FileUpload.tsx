import React, { useState, useRef } from 'react';
import { UploadCloud, FileText, CheckCircle, AlertCircle, Cloud, HardDrive, Sparkles, FileCode } from 'lucide-react';

interface FileUploadProps {
  onProcessFiles?: (files: File[]) => void;
  onImportCloud?: (bucketUri: string) => void;
}

export const FileUpload: React.FC<FileUploadProps> = ({ onProcessFiles, onImportCloud }) => {
  const [sourceType, setSourceType] = useState<'local' | 'cloud'>('local');
  const [dragActive, setDragActive] = useState<boolean>(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [cloudUri, setCloudUri] = useState<string>('gs://maritime-inbox-bucket/batch-2026/');
  const inputRef = useRef<HTMLInputElement | null>(null);

  const acceptedExtensions = '.json,.txt,.pdf,.xlsx,.docx';

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      setSelectedFiles(Array.from(e.dataTransfer.files));
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setSelectedFiles(Array.from(e.target.files));
    }
  };

  const handleSubmit = () => {
    if (sourceType === 'local' && selectedFiles.length > 0 && onProcessFiles) {
      onProcessFiles(selectedFiles);
    } else if (sourceType === 'cloud' && onImportCloud) {
      onImportCloud(cloudUri);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xl p-6 w-full max-w-2xl mx-auto text-slate-800">
      {/* Source Toggle Tabs */}
      <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-5">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-blue-600" />
            <h3 className="font-bold text-slate-900 text-lg tracking-tight">Document Ingestion Pipeline</h3>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">Upload local SI / BL manifests or trigger cloud bucket verification</p>
        </div>
        <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200/60">
          <button
            type="button"
            onClick={() => setSourceType('local')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              sourceType === 'local'
                ? 'bg-white text-blue-700 shadow-sm border border-slate-200'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <HardDrive className="w-3.5 h-3.5" /> Local Batch
          </button>
          <button
            type="button"
            onClick={() => setSourceType('cloud')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              sourceType === 'cloud'
                ? 'bg-white text-blue-700 shadow-sm border border-slate-200'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Cloud className="w-3.5 h-3.5" /> Cloud Bucket
          </button>
        </div>
      </div>

      {sourceType === 'local' ? (
        <>
          {/* Dropzone */}
          <div
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all duration-200 ${
              dragActive
                ? 'border-blue-500 bg-blue-50/60 shadow-sm'
                : 'border-slate-200 hover:border-slate-300 bg-slate-50/50 hover:bg-slate-50'
            }`}
          >
            <input
              ref={inputRef}
              type="file"
              multiple
              accept={acceptedExtensions}
              className="hidden"
              onChange={handleChange}
            />
            <div className="flex flex-col items-center">
              <div className="p-3.5 bg-blue-100/70 border border-blue-200 rounded-2xl text-blue-600 mb-3 shadow-xs">
                <UploadCloud className="w-7 h-7" />
              </div>
              <p className="text-sm font-semibold text-slate-800">
                Click to upload or drag & drop files here
              </p>
              <p className="text-xs text-slate-500 mt-1">
                Supported formats: <span className="font-mono text-blue-700 font-medium">JSON, TXT, PDF, XLSX, DOCX</span>
              </p>
            </div>
          </div>

          {/* Selected File Badges */}
          {selectedFiles.length > 0 && (
            <div className="mt-4 space-y-2">
              <p className="text-xs font-semibold text-slate-700 flex items-center justify-between">
                <span>Selected Documents ({selectedFiles.length})</span>
                <span className="text-[10px] text-blue-600 font-mono">Ready for LLM Parser</span>
              </p>
              <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1">
                {selectedFiles.map((file, idx) => (
                  <div key={idx} className="flex items-center justify-between px-3 py-2 bg-slate-50 border border-slate-200/80 rounded-lg text-xs">
                    <div className="flex items-center gap-2 truncate">
                      <FileCode className="w-4 h-4 text-blue-600 shrink-0" />
                      <span className="truncate text-slate-800 font-medium">{file.name}</span>
                    </div>
                    <span className="text-slate-500 font-mono text-[11px] shrink-0 ml-2">{(file.size / 1024).toFixed(1)} KB</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        /* Cloud Storage Selector */
        <div className="space-y-4 py-2">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Cloud Storage Bucket URI (GCS / AWS S3)
            </label>
            <input
              type="text"
              value={cloudUri}
              onChange={(e) => setCloudUri(e.target.value)}
              placeholder="e.g. s3://logistics-inbox-incoming/batch_01/"
              className="w-full text-xs px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-800 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-mono"
            />
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-900 flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <span>
              Ingesting from cloud storage triggers automated serverless extraction via Cloud Run & LLM comparison parser.
            </span>
          </div>
        </div>
      )}

      {/* Action Button */}
      <div className="mt-6 flex justify-end">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={sourceType === 'local' && selectedFiles.length === 0}
          className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white font-semibold text-xs rounded-xl transition-all shadow-sm flex items-center gap-2"
        >
          <CheckCircle className="w-4 h-4" />
          Process Batch Documents
        </button>
      </div>
    </div>
  );
};