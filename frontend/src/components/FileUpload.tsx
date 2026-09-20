import React, { useState, useRef } from 'react';
import { 
  FolderArchive, FileCode, FileSpreadsheet, HardDrive, 
  Cloud, CheckCircle2, AlertCircle, ArrowRight, Loader2
} from 'lucide-react';

export interface BatchPayload {
  sourceType: 'local' | 'cloud' | 'drive';
  inboxFiles?: File[];
  attachmentFiles?: File[];
  cloudConfig?: {
    provider: string;
    inboxUri: string;
    attachmentsUri: string;
  };
}

interface FileUploadProps {
  onSuccess?: () => void;
}

export const FileUpload: React.FC<FileUploadProps> = ({ onSuccess }) => {
  const [sourceType, setSourceType] = useState<'local' | 'cloud' | 'drive'>('local');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Local Dual-Folder State
  const [inboxFiles, setInboxFiles] = useState<File[]>([]);
  const [attachmentFiles, setAttachmentFiles] = useState<File[]>([]);

  // Cloud Storage URIs
  const [cloudInboxUri, setCloudInboxUri] = useState('s3://shipping-ops-bucket/inbox/');
  const [cloudAttachmentsUri, setCloudAttachmentsUri] = useState('s3://shipping-ops-bucket/attachments/');

  // Drive Folder URLs / IDs
  const [driveInboxUrl, setDriveInboxUrl] = useState('');
  const [driveAttachmentsUrl, setDriveAttachmentsUrl] = useState('');

  const inboxInputRef = useRef<HTMLInputElement | null>(null);
  const attachmentsInputRef = useRef<HTMLInputElement | null>(null);

  const handleInboxFolderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files).filter(f => f.name.endsWith('.json'));
      setInboxFiles(files);
    }
  };

  const handleAttachmentsFolderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const validExtensions = ['.txt', '.pdf', '.xlsx', '.docx'];
      const files = Array.from(e.target.files).filter(f => 
        validExtensions.some(ext => f.name.toLowerCase().endsWith(ext))
      );
      setAttachmentFiles(files);
    }
  };

  const canSubmit = 
    (sourceType === 'local' && inboxFiles.length > 0 && attachmentFiles.length > 0) ||
    (sourceType === 'cloud' && cloudInboxUri.trim() !== '' && cloudAttachmentsUri.trim() !== '') ||
    (sourceType === 'drive' && driveInboxUrl.trim() !== '' && driveAttachmentsUrl.trim() !== '');

  const handleStartProcessing = async () => {
    setIsSubmitting(true);
    try {
      let res: Response;

      if (sourceType === 'local') {
        const formData = new FormData();
        inboxFiles.forEach(f => formData.append('inbox_files', f));
        attachmentFiles.forEach(f => formData.append('attachment_files', f));

        res = await fetch('/api/ingest', { method: 'POST', body: formData });
      } else {
        res = await fetch('/api/ingest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source_type: sourceType,
            inbox_uri: sourceType === 'cloud' ? cloudInboxUri : driveInboxUrl,
            attachments_uri: sourceType === 'cloud' ? cloudAttachmentsUri : driveAttachmentsUrl
          })
        });
      }

      const data = await res.json();
      if (res.ok && data.status === 'success') {
        alert(`Batch Ingested Successfully!\nEmails: ${data.inbox_count || data.inbox_downloaded || inboxFiles.length}`);
        if (onSuccess) onSuccess();
      } else {
        alert(`Ingestion failed: ${data.message || 'Unknown error'}`);
      }
    } catch (err) {
      console.error(err);
      alert('Unable to connect to backend ingest service.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl w-full">
      {/* Top Header & Tabs */}
      <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-5">
        <div>
          <h3 className="font-extrabold text-slate-900 text-base font-sans">Batch Document Ingestion</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Ingest email records (<code className="text-blue-600 font-mono font-bold">inbox/</code>) and attachments (<code className="text-blue-600 font-mono font-bold">attachments/</code>)[cite: 1].
          </p>
        </div>

        {/* Source Switcher */}
        <div className="flex bg-slate-100 p-1 rounded-xl">
          {(['local', 'cloud', 'drive'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setSourceType(mode)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all ${
                sourceType === mode 
                  ? 'bg-white text-blue-700 shadow-xs border border-slate-200/80' 
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {mode === 'local' && <HardDrive className="w-3.5 h-3.5" />}
              {mode === 'cloud' && <Cloud className="w-3.5 h-3.5" />}
              {mode === 'drive' && <FolderArchive className="w-3.5 h-3.5" />}
              {mode}
            </button>
          ))}
        </div>
      </div>

      {/* Mode 1: Local Dual Folder Upload */}
      {sourceType === 'local' && (
        <div className="grid grid-cols-2 gap-4">
          
          {/* Folder 1: Inbox JSONs */}
          <div 
            onClick={() => inboxInputRef.current?.click()}
            className={`border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-all ${
              inboxFiles.length > 0 ? 'border-blue-400 bg-blue-50/20' : 'border-slate-200 hover:border-slate-300 bg-slate-50/60'
            }`}
          >
            <input
              ref={inboxInputRef}
              type="file"
              // @ts-expect-error webkitdirectory is standard in Chromium/Firefox
              webkitdirectory=""
              directory=""
              multiple
              className="hidden"
              onChange={handleInboxFolderChange}
            />
            <div className="flex flex-col items-center">
              <div className="p-3 bg-blue-100 rounded-xl text-blue-600 mb-2.5 shadow-2xs">
                <FileCode className="w-5 h-5" />
              </div>
              <p className="text-xs font-bold text-slate-900">1. Select "inbox" Folder</p>
              <p className="text-[11px] text-slate-400 font-mono mt-1">JSON Metadata Files</p>
              
              {inboxFiles.length > 0 ? (
                <div className="mt-3.5 flex items-center gap-1.5 text-xs text-blue-700 font-mono font-bold bg-blue-100/70 px-2.5 py-1 rounded-lg">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {inboxFiles.length} JSONs loaded
                </div>
              ) : (
                <span className="mt-3.5 text-xs text-blue-600 font-semibold hover:underline">Choose folder</span>
              )}
            </div>
          </div>

          {/* Folder 2: Attachments */}
          <div 
            onClick={() => attachmentsInputRef.current?.click()}
            className={`border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-all ${
              attachmentFiles.length > 0 ? 'border-emerald-400 bg-emerald-50/20' : 'border-slate-200 hover:border-slate-300 bg-slate-50/60'
            }`}
          >
            <input
              ref={attachmentsInputRef}
              type="file"
              // @ts-expect-error webkitdirectory is standard in Chromium/Firefox
              webkitdirectory=""
              directory=""
              multiple
              className="hidden"
              onChange={handleAttachmentsFolderChange}
            />
            <div className="flex flex-col items-center">
              <div className="p-3 bg-emerald-100 rounded-xl text-emerald-600 mb-2.5 shadow-2xs">
                <FileSpreadsheet className="w-5 h-5" />
              </div>
              <p className="text-xs font-bold text-slate-900">2. Select "attachments" Folder</p>
              <p className="text-[11px] text-slate-400 font-mono mt-1">TXT, PDF, XLSX Files</p>
              
              {attachmentFiles.length > 0 ? (
                <div className="mt-3.5 flex items-center gap-1.5 text-xs text-emerald-700 font-mono font-bold bg-emerald-100/70 px-2.5 py-1 rounded-lg">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {attachmentFiles.length} files loaded
                </div>
              ) : (
                <span className="mt-3.5 text-xs text-emerald-600 font-semibold hover:underline">Choose folder</span>
              )}
            </div>
          </div>

        </div>
      )}

      {/* Mode 2: Cloud Object Storage (S3 / GCS) */}
      {sourceType === 'cloud' && (
        <div className="space-y-3.5 py-1">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1 font-mono">
              Inbox S3/GCS URI (JSON records)
            </label>
            <input
              type="text"
              value={cloudInboxUri}
              onChange={(e) => setCloudInboxUri(e.target.value)}
              className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:border-blue-500 font-mono text-slate-800 bg-slate-50"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1 font-mono">
              Attachments S3/GCS URI (Documents)
            </label>
            <input
              type="text"
              value={cloudAttachmentsUri}
              onChange={(e) => setCloudAttachmentsUri(e.target.value)}
              className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:border-blue-500 font-mono text-slate-800 bg-slate-50"
            />
          </div>
        </div>
      )}

      {/* Mode 3: Google Drive Shared Folders */}
      {sourceType === 'drive' && (
        <div className="space-y-3.5 py-1">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1 font-mono">
              Google Drive Folder: inbox/ (JSON)
            </label>
            <input
              type="text"
              placeholder="https://drive.google.com/drive/folders/..."
              value={driveInboxUrl}
              onChange={(e) => setDriveInboxUrl(e.target.value)}
              className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:border-blue-500 font-mono text-slate-800 bg-slate-50"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1 font-mono">
              Google Drive Folder: attachments/ (Docs)
            </label>
            <input
              type="text"
              placeholder="https://drive.google.com/drive/folders/..."
              value={driveAttachmentsUrl}
              onChange={(e) => setDriveAttachmentsUrl(e.target.value)}
              className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:border-blue-500 font-mono text-slate-800 bg-slate-50"
            />
          </div>
        </div>
      )}

      {/* Bottom Action Footer */}
      <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[11px] text-slate-400 font-mono">
          <AlertCircle className="w-3.5 h-3.5 text-blue-600 shrink-0" />
          <span>Requires matching email IDs between both folders[cite: 1].</span>
        </div>

        <button
          type="button"
          onClick={handleStartProcessing}
          disabled={!canSubmit || isSubmitting}
          className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 disabled:cursor-not-allowed text-white text-xs font-bold rounded-xl transition-all shadow-sm flex items-center gap-2 cursor-pointer"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Uploading & Processing...</span>
            </>
          ) : (
            <>
              <span>Run Verification</span>
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>
      </div>

    </div>
  );
};