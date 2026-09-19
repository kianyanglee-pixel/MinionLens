import React, { useState, useRef } from 'react';
import { 
  FolderArchive, FileCode, FileSpreadsheet, HardDrive, 
  Cloud, CheckCircle2, AlertCircle, ArrowRight
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
  onIngestBatch?: (payload: BatchPayload) => void;
}

export const FileUpload: React.FC<FileUploadProps> = ({ onIngestBatch }) => {
  const [sourceType, setSourceType] = useState<'local' | 'cloud' | 'drive'>('local');

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

  // Filter and store Inbox JSON files
  const handleInboxFolderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files).filter(f => f.name.endsWith('.json'));
      setInboxFiles(files);
    }
  };

  // Filter and store Attachment files (.txt, .pdf, .xlsx, .docx)
  const handleAttachmentsFolderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const validExtensions = ['.txt', '.pdf', '.xlsx', '.docx'];
      const files = Array.from(e.target.files).filter(f => 
        validExtensions.some(ext => f.name.toLowerCase().endsWith(ext))
      );
      setAttachmentFiles(files);
    }
  };

  const handleStartProcessing = () => {
    if (!onIngestBatch) return;

    if (sourceType === 'local') {
      onIngestBatch({
        sourceType: 'local',
        inboxFiles,
        attachmentFiles
      });
    } else if (sourceType === 'cloud') {
      onIngestBatch({
        sourceType: 'cloud',
        cloudConfig: {
          provider: 'S3 / GCS',
          inboxUri: cloudInboxUri,
          attachmentsUri: cloudAttachmentsUri
        }
      });
    } else {
      onIngestBatch({
        sourceType: 'drive',
        cloudConfig: {
          provider: 'Google Drive',
          inboxUri: driveInboxUrl,
          attachmentsUri: driveAttachmentsUrl
        }
      });
    }
  };

  const canSubmit = 
    (sourceType === 'local' && inboxFiles.length > 0 && attachmentFiles.length > 0) ||
    (sourceType === 'cloud' && cloudInboxUri.trim() !== '' && cloudAttachmentsUri.trim() !== '') ||
    (sourceType === 'drive' && driveInboxUrl.trim() !== '' && driveAttachmentsUrl.trim() !== '');

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 w-full max-w-2xl mx-auto">
      
      {/* Top Header & Tabs */}
      <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-5">
        <div>
          <h3 className="font-bold text-slate-900 text-base">Batch Ingestion</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Ingest both the email metadata (<code className="text-indigo-600 font-mono">inbox/</code>) and document attachments (<code className="text-indigo-600 font-mono">attachments/</code>).
          </p>
        </div>

        {/* Source Switcher */}
        <div className="flex bg-slate-100 p-1 rounded-lg">
          <button
            type="button"
            onClick={() => setSourceType('local')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              sourceType === 'local' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <HardDrive className="w-3.5 h-3.5" /> Local
          </button>
          <button
            type="button"
            onClick={() => setSourceType('cloud')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              sourceType === 'cloud' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <Cloud className="w-3.5 h-3.5" /> S3 / GCS
          </button>
          <button
            type="button"
            onClick={() => setSourceType('drive')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              sourceType === 'drive' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <FolderArchive className="w-3.5 h-3.5" /> Drive
          </button>
        </div>
      </div>

      {/* Mode 1: Local Dual Folder Upload */}
      {sourceType === 'local' && (
        <div className="grid grid-cols-2 gap-4">
          
          {/* Folder 1: Inbox JSONs */}
          <div 
            onClick={() => inboxInputRef.current?.click()}
            className={`border-2 border-dashed rounded-lg p-5 text-center cursor-pointer transition-colors ${
              inboxFiles.length > 0 ? 'border-indigo-400 bg-indigo-50/20' : 'border-slate-200 hover:border-slate-300 bg-slate-50/50'
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
              <div className="p-2.5 bg-blue-100 rounded-full text-blue-600 mb-2">
                <FileCode className="w-5 h-5" />
              </div>
              <p className="text-xs font-semibold text-slate-800">1. Select "inbox" Folder</p>
              <p className="text-[11px] text-slate-400 mt-1">Contains email JSON metadata</p>
              
              {inboxFiles.length > 0 ? (
                <div className="mt-3 flex items-center gap-1 text-xs text-indigo-700 font-medium bg-indigo-100/70 px-2 py-1 rounded">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {inboxFiles.length} JSONs loaded
                </div>
              ) : (
                <span className="mt-3 text-[11px] text-slate-400 underline">Browse folder</span>
              )}
            </div>
          </div>

          {/* Folder 2: Attachments */}
          <div 
            onClick={() => attachmentsInputRef.current?.click()}
            className={`border-2 border-dashed rounded-lg p-5 text-center cursor-pointer transition-colors ${
              attachmentFiles.length > 0 ? 'border-emerald-400 bg-emerald-50/20' : 'border-slate-200 hover:border-slate-300 bg-slate-50/50'
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
              <div className="p-2.5 bg-emerald-100 rounded-full text-emerald-600 mb-2">
                <FileSpreadsheet className="w-5 h-5" />
              </div>
              <p className="text-xs font-semibold text-slate-800">2. Select "attachments" Folder</p>
              <p className="text-[11px] text-slate-400 mt-1">Contains .txt, .pdf, .xlsx</p>
              
              {attachmentFiles.length > 0 ? (
                <div className="mt-3 flex items-center gap-1 text-xs text-emerald-700 font-medium bg-emerald-100/70 px-2 py-1 rounded">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {attachmentFiles.length} files loaded
                </div>
              ) : (
                <span className="mt-3 text-[11px] text-slate-400 underline">Browse folder</span>
              )}
            </div>
          </div>

        </div>
      )}

      {/* Mode 2: Cloud Object Storage (S3 / GCS) */}
      {sourceType === 'cloud' && (
        <div className="space-y-3.5 py-1">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Inbox Bucket Prefix (JSON records)
            </label>
            <input
              type="text"
              value={cloudInboxUri}
              onChange={(e) => setCloudInboxUri(e.target.value)}
              className="w-full text-xs px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono text-slate-700"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Attachments Bucket Prefix (Documents)
            </label>
            <input
              type="text"
              value={cloudAttachmentsUri}
              onChange={(e) => setCloudAttachmentsUri(e.target.value)}
              className="w-full text-xs px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono text-slate-700"
            />
          </div>
        </div>
      )}

      {/* Mode 3: Google Drive Shared Folders */}
      {sourceType === 'drive' && (
        <div className="space-y-3.5 py-1">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Google Drive Folder Link: <span className="font-normal text-slate-400">inbox/ (JSONs)</span>
            </label>
            <input
              type="text"
              placeholder="https://drive.google.com/drive/folders/1aBc..."
              value={driveInboxUrl}
              onChange={(e) => setDriveInboxUrl(e.target.value)}
              className="w-full text-xs px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 text-slate-700"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Google Drive Folder Link: <span className="font-normal text-slate-400">attachments/ (Docs)</span>
            </label>
            <input
              type="text"
              placeholder="https://drive.google.com/drive/folders/2xYz..."
              value={driveAttachmentsUrl}
              onChange={(e) => setDriveAttachmentsUrl(e.target.value)}
              className="w-full text-xs px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 text-slate-700"
            />
          </div>
        </div>
      )}

      {/* Bottom Action Footer */}
      <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between">
        <div className="flex items-center gap-1 text-[11px] text-slate-400">
          <AlertCircle className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <span>Requires matching email IDs between both folders.</span>
        </div>

        <button
          type="button"
          onClick={handleStartProcessing}
          disabled={!canSubmit}
          className="px-4 py-2 bg-[#1E2538] hover:bg-slate-800 disabled:bg-slate-200 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-lg transition-colors shadow-sm flex items-center gap-1.5"
        >
          <span>Run Verification</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>

    </div>
  );
};