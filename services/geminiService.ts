
import { GoogleGenAI, Type } from "@google/genai";
import { Attendee, AttendanceStatus, ProcessingResult, MatchSensitivity } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
const modelName = "gemini-3-flash-preview";

/**
 * وظيفة لاستخراج الأسماء من صورة واحدة
 */
export const extractNamesFromImage = async (
  base64Data: string, 
  isOfficialList: boolean = false
): Promise<string[]> => {
  try {
    const prompt = isOfficialList 
      ? `This is an official registration list. Extract ALL full names of people. 
         Ignore headers, numbers, or dates. Return ONLY names, one per line. Support Arabic and English.`
      : `This is a Zoom participant list. Identify and extract ALL participant names. 
         Ignore technical details like "(Host)", "(Me)", icons, or status. Return ONLY names, one per line.`;

    const imageData = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;

    const response = await ai.models.generateContent({
      model: modelName,
      contents: {
        parts: [
          { inlineData: { data: imageData, mimeType: "image/png" } },
          { text: prompt }
        ]
      }
    });

    const extracted = response.text || "";
    return extracted.split("\n")
      .map(name => name.trim())
      .filter(name => name.length > 1);
  } catch (error) {
    console.error("Error extracting names from image:", error);
    return [];
  }
};

export const processAttendance = async (
  officialNames: string[],
  imageDatas: string[],
  sensitivity: MatchSensitivity,
  onProgress: (message: string) => void
): Promise<ProcessingResult> => {
  
  const zoomNamesSet = new Set<string>();
  
  for (let i = 0; i < imageDatas.length; i++) {
    onProgress(`جاري استخراج الحضور من لقطة زووم رقم ${i + 1}...`);
    const names = await extractNamesFromImage(imageDatas[i], false);
    names.forEach(n => zoomNamesSet.add(n));
  }

  if (zoomNamesSet.size === 0) {
    throw new Error("لم يتم العثور على أي أسماء حضور في لقطات زووم المرفوعة. يرجى التأكد من وضوح الصور.");
  }

  onProgress(`جاري تحليل ومطابقة الأسماء (الحساسية: ${sensitivity})...`);

  const sensitivityInstructions = {
    [MatchSensitivity.STRICT]: "Be very strict. Only match names that are clearly the same person with very minor differences.",
    [MatchSensitivity.BALANCED]: "Allow common spelling variations, cross-lingual matches, and ignore titles like 'Dr.', 'Pharmacist'.",
    [MatchSensitivity.FLEXIBLE]: "Be very aggressive. Ignore all titles. Match even if only parts of the name match or typos exist."
  };

  const prompt = `
    Compare List A (Official) with List B (Zoom).
    Sensitivity: ${sensitivityInstructions[sensitivity]}

    List A (Official):
    ${officialNames.join("\n")}

    List B (Zoom):
    ${Array.from(zoomNamesSet).join("\n")}

    Return a JSON object:
    {
      "present": [{"name": "Name from List A", "originalName": "Matched from List B"}],
      "absent": ["Names from List A not found"],
      "unexpected": ["Names in List B not in List A"]
    }
  `;

  const matchResponse = await ai.models.generateContent({
    model: modelName,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          present: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                originalName: { type: Type.STRING }
              },
              required: ["name", "originalName"]
            }
          },
          absent: { type: Type.ARRAY, items: { type: Type.STRING } },
          unexpected: { type: Type.ARRAY, items: { type: Type.STRING } }
        },
        required: ["present", "absent", "unexpected"]
      }
    }
  });

  try {
    const results = JSON.parse(matchResponse.text);
    return {
      present: results.present.map((p: any) => ({ name: p.name, originalName: p.originalName, status: AttendanceStatus.PRESENT })),
      absent: results.absent.map((name: string) => ({ name, status: AttendanceStatus.ABSENT })),
      unexpected: results.unexpected.map((name: string) => ({ name, status: AttendanceStatus.UNEXPECTED }))
    };
  } catch (e) {
    throw new Error("فشل في تحليل نتائج المطابقة من الذكاء الاصطناعي. يرجى المحاولة مرة أخرى.");
  }
};
