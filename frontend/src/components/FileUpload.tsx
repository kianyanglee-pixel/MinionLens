import React, { useState, useRef } from 'react';
import { UploadCloud, FileText, CheckCircle, AlertCircle, Cloud, HardDrive } from 'lucide-react';

interface FileUploadProps {
  onProcessFiles?: (files: File[]) => void;
  onImportCloud?: (bucketUri: string) => void;
}

export const FileUpload: React.FC<FileUploadProps> = ({ onProcessFiles, onImportCloud }) => {
  const [sourceType, setSourceType] = useState<'local' | 'cloud'>('local');
  const [dragActive, setDragActive] = useState<boolean>(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [cloudUri, setCloudUri] = useState<string>('gs://shipping-inbox-bucket/batch-2026/');
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
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 w-full max-w-2xl mx-auto">
      {/* Source Toggle Tabs */}
      <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-5">
        <div>
          <h3 className="font-semibold text-slate-800 text-lg">Document Ingestion</h3>
          <p className="text-xs text-slate-500 mt-0.5">Upload local batches or trigger ingestion from cloud storage</p>
        </div>
        <div className="flex bg-slate-100 p-1 rounded-lg">
          <button
            type="button"
            onClick={() => setSourceType('local')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              sourceType === 'local' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <HardDrive className="w-3.5 h-3.5" /> Local Files
          </button>
          <button
            type="button"
            onClick={() => setSourceType('cloud')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              sourceType === 'cloud' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <Cloud className="w-3.5 h-3.5" /> Cloud Storage
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
            className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
              dragActive ? 'border-indigo-500 bg-indigo-50/40' : 'border-slate-200 hover:border-slate-300 bg-slate-50/50'
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
              <div className="p-3 bg-indigo-100/60 rounded-full text-indigo-600 mb-3">
                <UploadCloud className="w-6 h-6" />
              </div>
              <p className="text-sm font-medium text-slate-700">
                Click to upload or drag & drop files here
              </p>
              <p className="text-xs text-slate-400 mt-1">
                Supported formats: <span className="font-mono">JSON, TXT, PDF, XLSX, DOCX</span>
              </p>
            </div>
          </div>

          {/* Selected File Badges */}
          {selectedFiles.length > 0 && (
            <div className="mt-4 space-y-2">
              <p className="text-xs font-semibold text-slate-600">Selected Files ({selectedFiles.length})</p>
              <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1">
                {selectedFiles.map((file, idx) => (
                  <div key={idx} className="flex items-center justify-between px-3 py-2 bg-slate-50 border border-slate-100 rounded-md text-xs">
                    <div className="flex items-center gap-2 truncate">
                      <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                      <span className="truncate text-slate-700 font-medium">{file.name}</span>
                    </div>
                    <span className="text-slate-400 shrink-0 ml-2">{(file.size / 1024).toFixed(1)} KB</span>
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
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              Cloud Storage Bucket URI (GCS / AWS S3)
            </label>
            <input
              type="text"
              value={cloudUri}
              onChange={(e) => setCloudUri(e.target.value)}
              placeholder="e.g. s3://logistics-inbox-incoming/batch_01/"
              className="w-full text-xs px-3.5 py-2.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono text-slate-700"
            />
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <span>
              Ingesting from cloud storage triggers automated serverless extraction via Cloud Run/Lambda.
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
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 disabled:cursor-not-allowed text-white text-xs font-medium rounded-lg transition-colors shadow-sm flex items-center gap-1.5"
        >
          <CheckCircle className="w-4 h-4" />
          Process Documents
        </button>
      </div>
    </div>
  );
};