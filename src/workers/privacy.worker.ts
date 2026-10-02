/// <reference lib="webworker" />
import { analyze } from "../core/analysis";
import { protect } from "../core/mitigation";
import type { WorkerRequest, WorkerResponse } from "../types";

const worker = self as DedicatedWorkerGlobalScope;
worker.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  try {
    let response: WorkerResponse;
    if (request.type === "ANALYZE") {
      if (!request.payload.options || !request.payload.columns) throw new Error("Opsi analisis atau informasi kolom tidak tersedia.");
      response = { id: request.id, type: "ANALYZE_DONE", report: analyze(request.payload.points, request.payload.columns, request.payload.options) };
    } else {
      if (!request.payload.transforms) throw new Error("Pengaturan proteksi tidak tersedia.");
      response = { id: request.id, type: "PROTECT_DONE", result: protect(request.payload.points, request.payload.transforms) };
    }
    worker.postMessage(response);
  } catch (error) {
    worker.postMessage({ id: request.id, type: "ERROR", message: error instanceof Error ? error.message : "Analisis tidak dapat diselesaikan." } satisfies WorkerResponse);
  }
};
