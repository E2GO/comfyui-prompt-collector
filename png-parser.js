const fs = require('fs');

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/**
 * Read PNG tEXt and iTXt chunks as key-value pairs.
 */
function readPngMetadata(filePath) {
  const buf = fs.readFileSync(filePath);
  if (buf.length < 8 || !buf.slice(0, 8).equals(PNG_SIGNATURE)) return {};

  const metadata = {};
  let offset = 8;

  while (offset + 12 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    if (offset + 12 + length > buf.length) break;

    const data = buf.slice(offset + 8, offset + 8 + length);

    if (type === 'tEXt') {
      const nullIdx = data.indexOf(0);
      if (nullIdx >= 0) {
        const key = data.toString('utf8', 0, nullIdx);
        metadata[key] = data.toString('utf8', nullIdx + 1);
      }
    } else if (type === 'iTXt') {
      const nullIdx = data.indexOf(0);
      if (nullIdx >= 0) {
        const key = data.toString('utf8', 0, nullIdx);
        let pos = nullIdx + 1 + 2; // skip compression flag + method
        const langEnd = data.indexOf(0, pos);
        if (langEnd < 0) { offset += 12 + length; continue; }
        pos = langEnd + 1;
        const transEnd = data.indexOf(0, pos);
        if (transEnd < 0) { offset += 12 + length; continue; }
        pos = transEnd + 1;
        metadata[key] = data.toString('utf8', pos);
      }
    } else if (type === 'IEND') {
      break;
    }

    offset += 12 + length;
  }

  return metadata;
}

/**
 * Trace a node reference chain to find all CLIPTextEncode node IDs
 * reachable from a starting reference. Follows conditioning/clip/model refs.
 */
function traceToClipNodes(graph, startRef, visited = new Set()) {
  if (!Array.isArray(startRef) || typeof startRef[0] !== 'string') return [];
  const nodeId = startRef[0];
  if (visited.has(nodeId)) return [];
  visited.add(nodeId);

  const node = graph[nodeId];
  if (!node) return [];

  const ct = (node.class_type || '').toLowerCase();

  // Found a CLIPTextEncode — return its ID
  if (ct.includes('cliptextencode')) return [nodeId];

  // Otherwise trace through this node's inputs
  const results = [];
  if (node.inputs) {
    for (const val of Object.values(node.inputs)) {
      if (Array.isArray(val) && typeof val[0] === 'string') {
        results.push(...traceToClipNodes(graph, val, visited));
      }
    }
  }
  return results;
}

/**
 * Build a set of node IDs that are used as negative conditioning,
 * by tracing from sampler nodes' "negative" input.
 */
function findNegativeNodeIds(graph) {
  const negativeIds = new Set();

  for (const node of Object.values(graph)) {
    if (!node || !node.class_type) continue;
    const ct = node.class_type.toLowerCase();
    // Sampler nodes: KSampler, SamplerCustom, etc.
    if (ct.includes('sampler') || ct.includes('ksampler')) {
      const negRef = node.inputs?.negative;
      if (negRef) {
        for (const id of traceToClipNodes(graph, negRef)) {
          negativeIds.add(id);
        }
      }
    }
  }

  return negativeIds;
}

/**
 * Extract ComfyUI prompts from a PNG file's metadata.
 * @param {string} filePath - Path to the PNG file
 * @returns {Array<{type: 'positive'|'negative'|'trigger', text: string}>}
 */
function extractPrompts(filePath) {
  try {
    const metadata = readPngMetadata(filePath);
    if (!metadata.prompt) return [];

    let graph;
    try {
      // ComfyUI sometimes writes NaN/Infinity in JSON — sanitize before parsing
      const sanitized = metadata.prompt
        .replace(/\bNaN\b/g, 'null')
        .replace(/\bInfinity\b/g, 'null')
        .replace(/-Infinity\b/g, 'null');
      graph = JSON.parse(sanitized);
    } catch {
      return [];
    }

    if (typeof graph !== 'object' || graph === null) return [];

    // Trace negative conditioning from samplers
    const negativeNodeIds = findNegativeNodeIds(graph);

    const results = [];

    for (const [nodeId, node] of Object.entries(graph)) {
      if (!node || !node.class_type || !node.inputs) continue;

      const classType = node.class_type.toLowerCase();
      const title = ((node._meta && node._meta.title) || '').toLowerCase();

      // Trigger words from LoRA loaders
      if (classType.includes('lora')) {
        for (const [key, value] of Object.entries(node.inputs)) {
          if (key.toLowerCase().includes('trigger') && typeof value === 'string' && value.trim().length > 5) {
            results.push({ type: 'trigger', text: value.trim() });
          }
        }
        continue;
      }

      // CLIPTextEncode nodes
      if (classType.includes('cliptextencode')) {
        const isNegative = negativeNodeIds.has(nodeId) ||
          title.includes('negative') || title.includes('neg ');
        extractTextFields(node.inputs, isNegative ? 'negative' : 'positive', results);
        continue;
      }

      // Conditioning nodes (PowderConditioner, etc.)
      if (classType.includes('conditioner') && !classType.includes('conditioning')) {
        const isNegative = title.includes('negative') || title.includes('neg ');
        extractTextFields(node.inputs, isNegative ? 'negative' : 'positive', results);
        continue;
      }

      // Primitive string / text input nodes
      if (
        classType.includes('primitivestring') ||
        classType.includes('text input') ||
        classType.includes('textinput') ||
        classType.includes('string input') ||
        classType.includes('stringinput')
      ) {
        const isNegative = title.includes('negative') || title.includes('neg ');
        extractTextFields(node.inputs, isNegative ? 'negative' : 'positive', results);
        continue;
      }
    }

    return results;
  } catch {
    return [];
  }
}

/**
 * Extract text from standard input fields.
 */
function extractTextFields(inputs, type, results) {
  const textKeys = ['text', 'value', 'string', 'prompt'];
  for (const key of textKeys) {
    if (key in inputs) {
      const val = inputs[key];
      if (typeof val === 'string' && val.trim().length > 5) {
        results.push({ type, text: val.trim() });
      }
    }
  }
}

module.exports = { extractPrompts };
