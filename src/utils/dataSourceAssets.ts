import { fetchRemoteBytes, fetchRemoteJson } from "./remoteRepo";
import { resolveSourceResource, sourceTokenFor, serviceSourceFor } from "./dataSourceRequest";

async function imageData(url: string): Promise<string> {
  const buffer = await fetchRemoteBytes(url);
  const data = new Uint8Array(buffer);
  let binary = "";
  for (let offset = 0; offset < data.length; offset += 8192)
    binary += String.fromCharCode(...data.subarray(offset, offset + 8192));
  const ext = new URL(url).pathname.toLowerCase();
  const mime = ext.endsWith(".png")
    ? "image/png"
    : ext.endsWith(".gif")
      ? "image/gif"
      : ext.endsWith(".webp")
        ? "image/webp"
        : "image/jpeg";
  return `data:${mime};base64,${btoa(binary)}`;
}
/** Store source images locally alongside questions, so downloaded banks work offline. */
export async function hydrateSourceBank(
  data: any,
  downloadUrl: string,
  imagePath?: string,
): Promise<any> {
  if (!sourceTokenFor(downloadUrl) || !Array.isArray(data.questions))
    return data;
  const base = serviceSourceFor(downloadUrl)!.url;
  const cache = new Map<string, Promise<string>>();
  const load = (url: string) => {
    let item = cache.get(url);
    if (!item) {
      item = imageData(url);
      cache.set(url, item);
    }
    return item;
  };
  const image = (path: string) =>
    path.startsWith("data:")
      ? Promise.resolve(path)
      : load(resolveSourceResource(new URL(path, downloadUrl).href, base));
  const indexed = new Map<number, string[]>();
  if (imagePath) {
    const files =
      await fetchRemoteJson<
        { name: string; type: string; download_url: string }[]
      >(imagePath);
    if (!Array.isArray(files)) throw new Error("题库图片索引无效");
    for (const file of files) {
      const match = file.name.match(/^(\d+)-(\d+)\.(png|jpe?g|gif|webp)$/i);
      if (file.type === "file" && match) {
        const i = Number(match[1]) - 1;
        indexed.set(i, [
          ...(indexed.get(i) ?? []),
          resolveSourceResource(file.download_url, base),
        ]);
      }
    }
  }
  const questions = [];
  for (let i = 0; i < data.questions.length; i++) {
    const q = data.questions[i];
    const paths = indexed.get(i) ?? q.images;
    const images = Array.isArray(paths)
      ? await Promise.all(paths.map(image))
      : paths;
    const answer =
      q.correctAnswer &&
      typeof q.correctAnswer === "object" &&
      !Array.isArray(q.correctAnswer) &&
      Array.isArray(q.correctAnswer.images)
        ? {
            ...q.correctAnswer,
            images: await Promise.all(q.correctAnswer.images.map(image)),
          }
        : q.correctAnswer;
    questions.push({ ...q, images, correctAnswer: answer });
  }
  return { ...data, questions };
}
