import React, { useState, useRef, useEffect } from 'react';
import {
  FolderArchive, FileCode, FileSpreadsheet, HardDrive,
  Cloud, Database, CheckCircle2, AlertCircle, ArrowRight, Loader2
} from 'lucide-react';
import JSZip from 'jszip';
import { apiUrl, readJson } from '../api';

interface FileUploadProps {
  onStartStream: (runId: string, totalCount: number) => void;
}

export const FileUpload: React.FC<FileUploadProps> = ({ onStartStream }) => {
  const [sourceType, setSourceType] = useState<'local' | 'cloud' | 'drive' | 'database'>('local');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatusMsg, setUploadStatusMsg] = useState('');

  // Local Dual-Folder State
  const [inboxFiles, setInboxFiles] = useState<File[]>([]);
  const [attachmentFiles, setAttachmentFiles] = useState<File[]>([]);

  // Cloud Storage URIs (S3 or GCS)
  const [cloudInboxUri, setCloudInboxUri] = useState('s3://shipping-ops-bucket/inbox/');
  const [cloudAttachmentsUri, setCloudAttachmentsUri] = useState('s3://shipping-ops-bucket/attachments/');

  // Google Drive Shared/Public Folder Links or IDs
  const [driveInboxUrl, setDriveInboxUrl] = useState('');
  const [driveAttachmentsUrl, setDriveAttachmentsUrl] = useState('');

  // Database connection — defaults to whatever the backend is already
  // configured with (fetched from /api/config), editable to point at any
  // other Supabase project instead.
  const [dbUrl, setDbUrl] = useState('');
  const [dbKey, setDbKey] = useState('');
  const [llmApiKey, setLlmApiKey] = useState('');
  const [llmProvider, setLlmProvider] = useState('gemini');
  const [llmModel, setLlmModel] = useState('');
  const [llmRequiresApiKey, setLlmRequiresApiKey] = useState(true);
  const [serverHasLlmApiKey, setServerHasLlmApiKey] = useState(false);

  useEffect(() => {
    fetch(apiUrl('/api/config'))
      .then((res) => res.json())
      .then((data) => {
        setLlmProvider(data.llm_provider || 'gemini');
        setLlmModel(data.llm_model || '');
        setLlmRequiresApiKey(Boolean(data.llm_requires_api_key));
        setServerHasLlmApiKey(Boolean(data.llm_api_key_configured));
        if (data.status === 'success' && data.default_supabase_url) {
          setDbUrl(data.default_supabase_url);
        }
      })
      .catch(() => {/* Database tab still works with the field left blank — backend falls back to its own default */});
  }, []);

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
    (!llmRequiresApiKey || serverHasLlmApiKey || llmApiKey.trim() !== '') && (
      (sourceType === 'local' && inboxFiles.length > 0 && attachmentFiles.length > 0) ||
      (sourceType === 'cloud' && cloudInboxUri.trim() !== '' && cloudAttachmentsUri.trim() !== '') ||
      (sourceType === 'drive' && driveInboxUrl.trim() !== '' && driveAttachmentsUrl.trim() !== '') ||
      sourceType === 'database'
    );

  const handleStartProcessing = async () => {
    if (llmRequiresApiKey && !serverHasLlmApiKey && !llmApiKey.trim()) {
      setUploadStatusMsg(`Enter a ${llmProvider} API key before running verification.`);
      return;
    }

    setIsUploading(true);
    const startedAt = new Date().toISOString();

    try {
      let res: Response;

      if (sourceType === 'local') {
        setUploadStatusMsg('Compressing batch files in memory...');
        const zip = new JSZip();
        const inboxFolder = zip.folder('inbox');
        const attFolder = zip.folder('attachments');

        inboxFiles.forEach(f => {
          inboxFolder?.file(f.name, f);
        });

        attachmentFiles.forEach(f => {
          attFolder?.file(f.name, f);
        });

        const zipBlob = await zip.generateAsync({
          type: 'blob',
          compression: 'DEFLATE',
          compressionOptions: { level: 4 }
        });

        setUploadStatusMsg('Uploading bundled archive...');
        const formData = new FormData();
        formData.append('batch_archive', zipBlob, 'batch.zip');
        formData.append('started_at', startedAt);
        formData.append('email_count', String(inboxFiles.length));
        if (llmApiKey.trim()) formData.append('llm_api_key', llmApiKey.trim());

        res = await fetch(apiUrl('/api/ingest'), { method: 'POST', body: formData });
      } else if (sourceType === 'database') {
        setUploadStatusMsg('Reading dataset already in the database...');
        res = await fetch(apiUrl('/api/ingest'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source_type: 'database',
            started_at: startedAt,
            supabase_url: dbUrl.trim(),
            supabase_key: dbKey.trim(),
            llm_api_key: llmApiKey.trim() || undefined,
          })
        });
      } else {
        setUploadStatusMsg(`Syncing from remote ${sourceType}...`);
        res = await fetch(apiUrl('/api/ingest'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source_type: sourceType,
            started_at: startedAt,
            inbox_uri: sourceType === 'cloud' ? cloudInboxUri : driveInboxUrl,
            attachments_uri: sourceType === 'cloud' ? cloudAttachmentsUri : driveAttachmentsUrl,
            llm_api_key: llmApiKey.trim() || undefined,
          })
        });
      }

      const data = await readJson<{ status?: string; run_id?: string; message?: string; inbox_count?: number; inbox_downloaded?: number }>(res);

      if (res.ok && data.status === 'success' && data.run_id) {
        const count = data.inbox_count || data.inbox_downloaded || inboxFiles.length;
        onStartStream(data.run_id, count);
      } else {
        alert(`Ingestion failed: ${data.message || 'Unknown error'}`);
        setIsUploading(false);
      }
    } catch (err: any) {
      console.error(err);
      alert(`Backend Error: ${err.message || 'Unable to connect to backend.'}`);
      setIsUploading(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl w-full min-w-0">
      {/* Header & Source Switcher */}
      <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-5">
        <div>
          <h3 className="font-extrabold text-slate-900 text-base font-sans">Batch Document Ingestion</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Ingest email records (<code className="text-blue-600 font-mono font-bold">inbox/</code>) and attachments (<code className="text-blue-600 font-mono font-bold">attachments/</code>).
          </p>
        </div>

        <div className="flex bg-slate-100 p-1 rounded-xl">
          {(['local', 'database', 'cloud', 'drive'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setSourceType(mode)}
              disabled={isUploading}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all ${
                sourceType === mode
                  ? 'bg-white text-blue-700 shadow-xs border border-slate-200/80'
                  : 'text-slate-500 hover:text-slate-800 disabled:opacity-50'
              }`}
            >
              {mode === 'local' && <HardDrive className="w-3.5 h-3.5" />}
              {mode === 'database' && <Database className="w-3.5 h-3.5" />}
              {mode === 'cloud' && <Cloud className="w-3.5 h-3.5" />}
              {mode === 'drive' && <FolderArchive className="w-3.5 h-3.5" />}
              {mode}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50/70 p-3">
        {llmRequiresApiKey ? (
          <>
            <label className="block text-xs font-bold text-slate-700 font-mono uppercase tracking-wider mb-1">
              {llmProvider} API key <span className="normal-case font-sans text-slate-400">({serverHasLlmApiKey ? 'optional for this run' : 'required unless configured on the backend'})</span>
            </label>
            <input
              type="password"
              value={llmApiKey}
              onChange={(e) => setLlmApiKey(e.target.value)}
              placeholder={serverHasLlmApiKey ? 'Leave blank to use the backend key' : `Enter ${llmProvider} API key`}
              autoComplete="off"
              className="w-full px-3 py-2 text-xs border border-amber-300 rounded-xl font-mono text-slate-800 bg-white focus:outline-none focus:border-amber-500"
            />
            <p className="text-[11px] text-amber-800/70 mt-1 font-mono">
              Sent for this run only. It is not saved in the database or batch files.
            </p>
          </>
        ) : (
          <p className="text-xs text-slate-700">
            Using local Ollama{llmModel ? <> model <code className="font-mono">{llmModel}</code></> : ''}. No API key is needed.
          </p>
        )}
      </div>

      {/* 1. LOCAL DIRECTORY MODE */}
      {sourceType === 'local' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <button
            type="button"
            onClick={() => inboxInputRef.current?.click()}
            className={`border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-all w-full ${
              inboxFiles.length > 0 ? 'border-blue-400 bg-blue-50/20' : 'border-slate-200 hover:border-slate-300 bg-slate-50/60'
            }`}
          >
            <input
              ref={inboxInputRef}
              type="file"
              // @ts-expect-error webkitdirectory standard
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
                  {inboxFiles.length} Emails Loaded
                </div>
              ) : (
                <span className="mt-3.5 text-xs text-blue-600 font-semibold hover:underline">Choose folder</span>
              )}
            </div>
          </button>

          <button
            type="button"
            onClick={() => attachmentsInputRef.current?.click()}
            className={`border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-all w-full ${
              attachmentFiles.length > 0 ? 'border-emerald-400 bg-emerald-50/20' : 'border-slate-200 hover:border-slate-300 bg-slate-50/60'
            }`}
          >
            <input
              ref={attachmentsInputRef}
              type="file"
              // @ts-expect-error webkitdirectory standard
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
                  {attachmentFiles.length} Files Loaded
                </div>
              ) : (
                <span className="mt-3.5 text-xs text-emerald-600 font-semibold hover:underline">Choose folder</span>
              )}
            </div>
          </button>
        </div>
      )}

      {/* DATABASE INGESTION — reads from a Supabase project's storage
          directly, no upload needed. Defaults to whichever project this
          server is already configured with; editable to point at any
          other Supabase project instead. */}
      {sourceType === 'database' && (
        <div className="space-y-4 py-2">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Database className="w-3.5 h-3.5 text-blue-600 shrink-0" />
            <span>Runs the pipeline over every email already stored there — nothing to upload.</span>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 font-mono uppercase tracking-wider mb-1">
              Supabase URL
            </label>
            <input
              type="text"
              value={dbUrl}
              onChange={(e) => setDbUrl(e.target.value)}
              placeholder="https://your-project.supabase.co"
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl font-mono text-slate-800 bg-slate-50 focus:bg-white focus:outline-none focus:border-blue-500"
            />
            <p className="text-[11px] text-slate-400 mt-1 font-mono">
              Defaults to the project this server is already connected to — change it to point at
              a different Supabase project instead.
            </p>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 font-mono uppercase tracking-wider mb-1">
              Supabase Key <span className="normal-case font-sans text-slate-400">(optional)</span>
            </label>
            <input
              type="password"
              value={dbKey}
              onChange={(e) => setDbKey(e.target.value)}
              placeholder="Leave blank to use this server's configured key"
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl font-mono text-slate-800 bg-slate-50 focus:bg-white focus:outline-none focus:border-blue-500"
            />
            <p className="text-[11px] text-slate-400 mt-1 font-mono">
              Only needed if you changed the URL above to a project this server doesn't already
              have a key for.
            </p>
          </div>
        </div>
      )}

      {/* 2. CLOUD BUCKET INGESTION (S3 / GCS) */}
      {sourceType === 'cloud' && (
        <div className="space-y-4 py-2">
          <div>
            <label className="block text-xs font-bold text-slate-700 font-mono uppercase tracking-wider mb-1">
              Inbox Bucket URI (S3 or GCS)
            </label>
            <input
              type="text"
              value={cloudInboxUri}
              onChange={(e) => setCloudInboxUri(e.target.value)}
              placeholder="s3://my-bucket/inbox/ or gs://my-bucket/inbox/"
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl font-mono text-slate-800 bg-slate-50 focus:bg-white focus:outline-none focus:border-blue-500"
            />
            <p className="text-[11px] text-slate-400 mt-1 font-mono">
              Target folder where email JSON objects are stored.
            </p>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 font-mono uppercase tracking-wider mb-1">
              Attachments Bucket URI (S3 or GCS)
            </label>
            <input
              type="text"
              value={cloudAttachmentsUri}
              onChange={(e) => setCloudAttachmentsUri(e.target.value)}
              placeholder="s3://my-bucket/attachments/ or gs://my-bucket/attachments/"
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl font-mono text-slate-800 bg-slate-50 focus:bg-white focus:outline-none focus:border-blue-500"
            />
            <p className="text-[11px] text-slate-400 mt-1 font-mono">
              Target folder where SI/BL documents (TXT, PDF, XLSX) reside.
            </p>
          </div>
        </div>
      )}

      {/* 3. GOOGLE DRIVE INGESTION */}
      {sourceType === 'drive' && (
        <div className="space-y-4 py-2">
          <div>
            <label className="block text-xs font-bold text-slate-700 font-mono uppercase tracking-wider mb-1">
              Google Drive "inbox" Folder URL or ID
            </label>
            <input
              type="text"
              value={driveInboxUrl}
              onChange={(e) => setDriveInboxUrl(e.target.value)}
              placeholder="https://drive.google.com/drive/folders/1aBcD... or folder ID"
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl font-mono text-slate-800 bg-slate-50 focus:bg-white focus:outline-none focus:border-blue-500"
            />
            <p className="text-[11px] text-slate-400 mt-1 font-mono">
              Link to public or service-account shared folder containing email JSONs.
            </p>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 font-mono uppercase tracking-wider mb-1">
              Google Drive "attachments" Folder URL or ID
            </label>
            <input
              type="text"
              value={driveAttachmentsUrl}
              onChange={(e) => setDriveAttachmentsUrl(e.target.value)}
              placeholder="https://drive.google.com/drive/folders/2xYzW... or folder ID"
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl font-mono text-slate-800 bg-slate-50 focus:bg-white focus:outline-none focus:border-blue-500"
            />
            <p className="text-[11px] text-slate-400 mt-1 font-mono">
              Link to public or service-account shared folder containing SI/BL attachments.
            </p>
          </div>
        </div>
      )}

      {/* Footer Controls */}
      <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[11px] text-slate-400 font-mono">
          <AlertCircle className="w-3.5 h-3.5 text-blue-600 shrink-0" />
          <span>{uploadStatusMsg || (
            sourceType === 'local' ? 'Files will be compressed and verified in batch' :
            sourceType === 'database' ? 'No files needed — reads directly from the database' :
            `Syncing via ${sourceType}`
          )}</span>
        </div>

        <button
          type="button"
          onClick={handleStartProcessing}
          disabled={!canSubmit || isUploading}
          className="px-5 py-2.5 bg-[#1e293b] hover:bg-[#0f172a] disabled:bg-slate-200 disabled:cursor-not-allowed text-white text-xs font-bold rounded-xl transition-all shadow-sm flex items-center gap-2 cursor-pointer"
        >
          {isUploading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>{uploadStatusMsg || 'Processing...'}</span>
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