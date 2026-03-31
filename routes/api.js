const express = require('express');
const router = express.Router();
const multer = require('multer');
const authMiddleware = require('../middleware/authMiddleware');
const supabase = require('../config/supabase');

const upload = multer({ storage: multer.memoryStorage() });

function inferUseFromMedicineName(name = '', isHindi = false) {
  const normalized = String(name).toLowerCase();
  const entries = [
    { keys: ['paracetamol', 'acetaminophen', 'calpol', 'crocin'], en: 'Fever and pain relief', hi: 'बुखार और दर्द से राहत' },
    { keys: ['ibuprofen', 'diclofenac', 'aceclofenac', 'naproxen'], en: 'Pain and inflammation relief', hi: 'दर्द और सूजन में राहत' },
    { keys: ['cetirizine', 'levocetirizine', 'loratadine', 'fexofenadine'], en: 'Allergy relief', hi: 'एलर्जी से राहत' },
    { keys: ['pantoprazole', 'omeprazole', 'rabeprazole', 'esomeprazole'], en: 'Acidity and reflux control', hi: 'एसिडिटी और रिफ्लक्स नियंत्रण' },
    { keys: ['amoxicillin', 'azithromycin', 'cef', 'doxycycline', 'ciprofloxacin'], en: 'Bacterial infection treatment', hi: 'बैक्टीरियल संक्रमण का उपचार' },
    { keys: ['metformin', 'glimepiride', 'insulin'], en: 'Blood sugar control', hi: 'ब्लड शुगर नियंत्रण' },
    { keys: ['amlodipine', 'telmisartan', 'losartan', 'atenolol', 'metoprolol'], en: 'Blood pressure control', hi: 'ब्लड प्रेशर नियंत्रण' },
    { keys: ['sertraline', 'escitalopram', 'fluoxetine'], en: 'Anxiety or mood symptom management', hi: 'चिंता या मूड लक्षण प्रबंधन' },
    { keys: ['montelukast', 'salbutamol', 'budesonide'], en: 'Breathing and allergy symptom control', hi: 'सांस और एलर्जी लक्षण नियंत्रण' }
  ];

  for (const entry of entries) {
    if (entry.keys.some((keyword) => normalized.includes(keyword))) {
      return isHindi ? entry.hi : entry.en;
    }
  }

  return isHindi ? 'सामान्य उपचार' : 'General treatment';
}

function normalizeMedicationEntry(medication, isHindi = false) {
  const mappedName = medication?.name || (isHindi ? 'दवा' : 'Medicine');
  const mappedDosage = medication?.dosage || 'Not specified';
  const mappedTiming = medication?.frequency || medication?.timing || 'Not specified';
  const mappedDuration = medication?.duration || 'Not specified';

  const normalizedUse = typeof medication?.use === 'string' && medication.use.trim()
    ? medication.use.trim()
    : null;

  return {
    name: mappedName,
    dosage: mappedDosage,
    timing: mappedTiming,
    duration: mappedDuration,
    use: normalizedUse
  };
}

// Gemini API helper function
async function callGeminiAPI(messages, maxTokens = 2000, responseFormat = null) {
  const apiKey = process.env.GEMINI_API_KEY;
  const geminiModel = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY not configured');
  }

  const url = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
  
  const body = {
    model: geminiModel,
    messages,
    temperature: 0.1,
    max_tokens: maxTokens
  };

  // Note: response_format is not fully supported in Gemini via OpenAI endpoint
  // We'll skip it for now and handle JSON parsing manually

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error(`❌ Gemini API error ${res.status}:`, errorText);
      throw new Error(`Gemini API error ${res.status}: ${errorText.substring(0, 200)}`);
    }

    const data = await res.json();
    if (!data?.choices?.[0]?.message) {
      throw new Error(`Gemini API returned unexpected response shape for model ${geminiModel}`);
    }
    return data;
  } catch (error) {
    console.error('❌ Gemini API call failed:', error.message);
    throw error;
  }
}

// Rule-based prescription extraction (completely free, no API required)
function extractPrescriptionWithRules(text, isHindi) {
  const lowerText = text.toLowerCase();
  
  // Common medication patterns - improved regex
  const medicationPatterns = [
    /(?:tab|tablet|capsule|cap|syrup|injection|inj)\s+([a-zA-Z][a-zA-Z\s]+?)(?:\s+(\d+(?:\.\d+)?)\s*(mg|g|ml|mcg|units?))?(?:\s+(od|bd|tid|qid|once|twice|thrice|daily|morning|evening|night))?(?:\s+for\s+(\d+)\s*(day|week|month)s?)?/gi,
    /([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*)\s+(\d+(?:\.\d+)?)\s*(mg|g|ml|mcg|units?)(?:\s+(od|bd|tid|qid|once|twice|thrice|daily))?(?:\s+for\s+(\d+)\s*(day|week|month)s?)?/gi
  ];
  
  const medications = [];
  let match;
  
  medicationPatterns.forEach(pattern => {
    while ((match = pattern.exec(text)) !== null) {
      const [, name, dosage, unit, timing, duration, durationUnit] = match;
      if (name && name.trim() && name.trim().length > 2) { // Filter out very short names
        medications.push({
          name: name.trim(),
          dosage: dosage && unit ? `${dosage}${unit}` : (dosage || 'Not specified'),
          timing: timing || 'Not specified',
          duration: duration && durationUnit ? `${duration} ${durationUnit}` : 'Not specified',
          use: inferUseFromMedicineName(name.trim(), isHindi)
        });
      }
    }
  });
  
  // If no medications found, try a simpler approach
  if (medications.length === 0) {
    // Look for common medication names
    const commonMeds = ['paracetamol', 'amoxicillin', 'azithromycin', 'ibuprofen', 'aspirin', 'cough syrup', 'antibiotic'];
    commonMeds.forEach(med => {
      if (lowerText.includes(med)) {
        medications.push({
          name: med.charAt(0).toUpperCase() + med.slice(1),
          dosage: 'Not specified',
          timing: 'Not specified',
          duration: 'Not specified',
          use: inferUseFromMedicineName(med, isHindi)
        });
      }
    });
  }
  
  // If still no medications, add a default one
  if (medications.length === 0) {
    medications.push({
      name: isHindi ? 'दवा का नाम नहीं मिला' : 'Medication name not found',
      dosage: 'Not specified',
      timing: 'Not specified', 
      duration: 'Not specified',
      use: isHindi ? 'अस्पष्ट दवा' : 'Unclear medicine'
    });
  }

  const normalizedMedications = medications.map((medication) => normalizeMedicationEntry(medication, isHindi));
  
  // Basic diagnosis extraction
  let diagnosis = isHindi ? 'निदान: सामान्य जांच' : 'Diagnosis: General checkup';
  if (lowerText.includes('fever') || lowerText.includes('बुखार')) {
    diagnosis = isHindi ? 'निदान: बुखार' : 'Diagnosis: Fever';
  } else if (lowerText.includes('cold') || lowerText.includes('cough') || lowerText.includes('सर्दी') || lowerText.includes('खांसी')) {
    diagnosis = isHindi ? 'निदान: सर्दी और खांसी' : 'Diagnosis: Cold and Cough';
  } else if (lowerText.includes('headache') || lowerText.includes('सिरदर्द')) {
    diagnosis = isHindi ? 'निदान: सिरदर्द' : 'Diagnosis: Headache';
  } else if (lowerText.includes('infection') || lowerText.includes('infection')) {
    diagnosis = isHindi ? 'निदान: संक्रमण' : 'Diagnosis: Infection';
  }
  
  // Basic side effects
  const side_effects = isHindi ? ['मतली', 'दस्त', 'सिरदर्द'] : ['Nausea', 'Diarrhea', 'Headache'];
  
  // Basic follow up
  const follow_up = isHindi ? ['1 सप्ताह बाद वापस आएं'] : ['Come back in 1 week'];
  
  // Summary
  const summary = isHindi 
    ? `${medications.length} दवाएं निर्धारित की गईं। नियमित जांच के लिए वापस आएं।`
    : `${medications.length} medications prescribed. Return for regular checkup.`;
  
  return {
    diagnosis,
    medications: normalizedMedications,
    side_effects,
    follow_up,
    summary
  };
}

// POST /api/analyze
router.post('/analyze', authMiddleware, upload.array('files'), async (req, res) => {
  try {
    let { text, age, language } = req.body;
    if (!text) { text = ""; }

    if (!req.files?.length && !text.trim()) {
      return res.status(400).json({ error: 'No prescription text or files to analyze' });
    }

    const isHindi = language === 'Hindi';
    const langNote = isHindi 
      ? `CRITICAL INSTRUCTION: You MUST respond ENTIRELY in Hindi (हिंदी). ALL text values in the JSON output MUST be written in Hindi/Devanagari script. This includes:
- "diagnosis" value MUST be in Hindi
- "summary" value MUST be in Hindi  
- All "name", "dosage", "timing", "duration" values in medications MUST be in Hindi
- All "side_effects" strings MUST be in Hindi
- All "follow_up" strings MUST be in Hindi
The JSON KEYS must remain in English, but every single TEXT VALUE must be in Hindi (हिंदी / देवनागरी लिपि).
Example: {"diagnosis": "रोगी को बुखार और खांसी है", "medications": [{"name": "पैरासिटामोल", "dosage": "500 मिलीग्राम", "timing": "दिन में दो बार", "duration": "5 दिन"}]}` 
      : 'Respond in English.';
      
    const ageNote = age ? `The patient is ${age} years old.` : '';
    
    const files = req.files || [];

    const systemPrompt = `You are a highly cautious medical assistant AI.

Your task is to analyze a doctor's prescription text and extract structured information.

STRICT RULES:
- Do NOT guess unclear or unreadable words.
- If a medicine name is uncertain, mark it as "uncertain".
- Only include medicines that are clearly identifiable.
- Do NOT invent medicines or medical details.
- If text is unclear, return a warning instead of guessing.
${langNote}

OUTPUT FORMAT (JSON ONLY, no extra text):
{
  "status": "success" | "uncertain",
  "medicines": [
    {
      "name": "",
      "dosage": "",
      "frequency": "",
      "duration": "",
      "use": ""
    }
  ],
  "warnings": []
}

GUIDELINES:
- "BD" = twice daily
- "TDS" = three times daily
- "OD" = once daily
- Extract dosage like 500mg, 250mg, etc.
- "use" must be medicine-specific and clinically relevant (e.g., antihistamine for allergy, antibiotic for infection)
- Do NOT return the same generic "use" value for all medicines

If prescription is unreadable:
Return:
{
  "status": "uncertain",
  "medicines": [],
  "warnings": ["Prescription is unclear. Please upload a clearer image."]
}`;

    const userPrompt = `${ageNote}\n\n${files.length > 0 ? 'This is a prescription document.' : 'Parse this prescription text.'}\n\nPrescription Text:\n---\n${text}\n---\n\nIf the text is unreadable, return: {"status": "uncertain", "medicines": [], "warnings": ["Prescription is unclear. Please upload a clearer image."]}`;

    // Check for API keys
    if (!process.env.GEMINI_API_KEY && !process.env.OPENAI_API_KEY) {
      console.warn("No API key provided. Using rule-based extraction.");
      const mockResult = extractPrescriptionWithRules(text, isHindi);
      
      await supabase.from('Prescriptions').insert([{
        userId: req.user.userId,
        summary: mockResult.summary,
        diagnosis: mockResult.diagnosis,
        medications: mockResult.medications,
        side_effects: mockResult.side_effects,
        follow_up: mockResult.follow_up,
        rawText: text
      }]);

      return res.json({ result: mockResult, rawText: text });
    }

    // Check Gemini API is available
    if (!process.env.GEMINI_API_KEY) {
      console.warn("No Gemini API key provided. Using rule-based extraction.");
      const mockResult = extractPrescriptionWithRules(text, isHindi);
      
      await supabase.from('Prescriptions').insert([{
        userId: req.user.userId,
        summary: mockResult.summary,
        diagnosis: mockResult.diagnosis,
        medications: mockResult.medications,
        side_effects: mockResult.side_effects,
        follow_up: mockResult.follow_up,
        rawText: text
      }]);

      return res.json({ result: mockResult, rawText: text });
    }

    // Build messages for Gemini
    const messages = [
      {
        role: 'user',
        content: systemPrompt + '\n\n' + userPrompt
      }
    ];

    let response;
    try {
      response = await callGeminiAPI(messages, 2000);
    } catch (apiError) {
      if (apiError.message && apiError.message.includes('Rate limit')) {
        console.warn("Gemini API rate limited. Using rule-based extraction.");
        const ruleResult = extractPrescriptionWithRules(text, isHindi);
        
        await supabase.from('Prescriptions').insert([{
          userId: req.user.userId,
          summary: ruleResult.summary,
          diagnosis: ruleResult.diagnosis,
          medications: ruleResult.medications,
          side_effects: ruleResult.side_effects,
          follow_up: ruleResult.follow_up,
          rawText: text
        }]);

        return res.json({ result: ruleResult, rawText: text });
      }
      throw apiError;
    }

    const raw = response?.choices?.[0]?.message?.content || '';
    let parsed;
    try {
      const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      parsed = JSON.parse(cleaned);
    } catch(parseErr) {
      console.warn('❌ Failed to parse Gemini JSON response. Using rule-based extraction instead.');
      console.warn('Raw response:', raw.substring(0, 200));
      const ruleResult = extractPrescriptionWithRules(text, isHindi);
      
      await supabase.from('Prescriptions').insert([{
        userId: req.user.userId,
        summary: ruleResult.summary,
        diagnosis: ruleResult.diagnosis,
        medications: ruleResult.medications,
        side_effects: ruleResult.side_effects,
        follow_up: ruleResult.follow_up,
        rawText: text
      }]);

      return res.json({ result: ruleResult, rawText: text });
    }

    // Map new format to the expected structured format for DB and frontend
    const mappedFormat = {
      summary: parsed.status === 'success' ? 'Prescription analyzed successfully.' : 'The prescription was unclear.',
      diagnosis: parsed.status === 'success' ? 'Prescription Analysis' : 'Uncertain',
      medications: (parsed.medicines || []).map(m => normalizeMedicationEntry(m, isHindi)),
      side_effects: parsed.warnings || [],
      follow_up: []
    };

    const { data: insertedData, error: insertError } = await supabase.from('Prescriptions').insert([{
      userId: req.user.userId,
      summary: mappedFormat.summary,
      diagnosis: mappedFormat.diagnosis,
      medications: mappedFormat.medications,
      side_effects: mappedFormat.side_effects,
      follow_up: mappedFormat.follow_up,
      rawText: text
    }]).select();

    if (insertError) {
      console.error("❌ Database insert error:", insertError);
      console.error("Attempted to save for userId:", req.user.userId);
      return res.status(500).json({ error: 'Failed to save prescription: ' + insertError.message });
    }

    console.log("✅ Successfully saved prescription for user:", req.user.userId, "Record:", insertedData?.[0]?.id);
    res.json({ result: mappedFormat, rawText: text, saved: true, recordId: insertedData?.[0]?.id });

  } catch (error) {
    console.error("Analysis Error:", error);
    res.status(500).json({ error: error.message || 'Error occurred during analysis' });
  }
});

// POST /api/save-history - Persist a precomputed analysis result
router.post('/save-history', authMiddleware, async (req, res) => {
  try {
    const { result, rawText = '' } = req.body || {};

    if (!result || typeof result !== 'object') {
      return res.status(400).json({ error: 'Result payload is required' });
    }

    const medications = Array.isArray(result.medications)
      ? result.medications.map((m) => normalizeMedicationEntry(m))
      : [];

    const payload = {
      userId: req.user.userId,
      summary: result.summary || 'Prescription analyzed successfully.',
      diagnosis: result.diagnosis || 'Prescription Analysis',
      medications,
      side_effects: Array.isArray(result.side_effects) ? result.side_effects : [],
      follow_up: Array.isArray(result.follow_up) ? result.follow_up : [],
      rawText
    };

    const { data, error } = await supabase
      .from('Prescriptions')
      .insert([payload])
      .select('id')
      .single();

    if (error) {
      console.error('❌ Save history insert error:', error);
      return res.status(500).json({ error: `Failed to save history: ${error.message}` });
    }

    return res.json({ saved: true, recordId: data?.id });
  } catch (error) {
    console.error('❌ Save history error:', error);
    return res.status(500).json({ error: error.message || 'Failed to save history' });
  }
});

// GET /api/history - Fetch user's prescription history
router.get('/history', authMiddleware, async (req, res) => {
  try {
    if (!req.user || !req.user.userId) {
      console.error('❌ No user ID in request');
      return res.status(401).json({ error: 'Unauthorized: No user ID found' });
    }

    console.log('📋 Fetching history for user:', req.user.userId);
    const { data: history, error } = await supabase
      .from('Prescriptions')
      .select('id, userId, summary, diagnosis, medications, side_effects, follow_up, rawText, createdAt, updatedAt')
      .eq('userId', req.user.userId)
      .order('createdAt', { ascending: false })
      .limit(50);
      
    if (error) {
      console.error('❌ Supabase select error:', error);
      throw error;
    }

    console.log(`✅ Fetched ${history?.length || 0} prescription records for user ${req.user.userId}`);
    res.json(history || []);
  } catch (error) {
    console.error("❌ History Error:", error);
    res.status(500).json({ error: error.message || 'Failed to fetch history' });
  }
});

// DELETE /api/history/:id - Delete one prescription history record for current user
router.delete('/history/:id', authMiddleware, async (req, res) => {
  try {
    if (!req.user || !req.user.userId) {
      return res.status(401).json({ error: 'Unauthorized: No user ID found' });
    }

    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: 'History id is required' });
    }

    const { data, error } = await supabase
      .from('Prescriptions')
      .delete()
      .eq('id', id)
      .eq('userId', req.user.userId)
      .select('id')
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ error: 'History item not found' });
      }
      console.error('❌ Delete history error:', error);
      return res.status(500).json({ error: `Failed to delete history: ${error.message}` });
    }

    return res.json({ deleted: true, id: data?.id || id });
  } catch (error) {
    console.error('❌ Delete history exception:', error);
    return res.status(500).json({ error: error.message || 'Failed to delete history' });
  }
});

// Optional auth for chat so unauthenticated users can still use it
router.post('/chat', async (req, res) => {
  // Try to authenticate if token is provided
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const jwt = require('jsonwebtoken');
      const JWT_SECRET = process.env.JWT_SECRET || 'secret-medbuddy-key';
      req.user = jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
    } catch(e) {}
  }

  try {
    const { message, prescriptionContext, history: chatHistory = [] } = req.body;
    if (!message?.trim()) return res.status(400).json({ error: 'Message required' });

    if (!process.env.GEMINI_API_KEY) {
      return res.json({ reply: "I'm sorry, Gemini API is not configured. Please add GEMINI_API_KEY to your .env file." });
    }

    const contextBlock = prescriptionContext
      ? `The user has uploaded a prescription with the following details:\n${JSON.stringify(prescriptionContext, null, 2)}\n\nUse this as context to answer questions. If the question is not about this prescription or general medical topics, politely redirect.`
      : `No prescription has been analyzed yet. If the user asks about a specific prescription, suggest they upload one first.`;

    const systemMsg = `You are MedBuddy, a friendly and knowledgeable medical assistant chatbot. You help users understand their prescriptions, medications, side effects, and general health queries. Keep responses concise (2-4 sentences max), friendly, and always add a professional disclaimer when giving medical advice. Never diagnose or replace a doctor.\n\n${contextBlock}`;

    const messages = [
      { role: 'user', content: systemMsg + '\n\nContext loaded. Ready to help!' },
      ...chatHistory.slice(-8).map(m => ({ role: m.role === 'bot' ? 'assistant' : 'user', content: m.content })),
      { role: 'user', content: message }
    ];

    const requester = req.user?.userId || 'guest';
    console.log(`📱 Chat request from user ${requester}: "${message.substring(0, 50)}..."`);

    const response = await callGeminiAPI(messages, 300);

    const reply = response?.choices?.[0]?.message?.content || "I couldn't generate a response. Please try again.";
    console.log(`✅ Chat response generated`);
    res.json({ reply });

  } catch (error) {
    console.error("❌ Chat Error:", error.message || error);
    if (error.message && error.message.includes('400')) {
      console.error("Invalid request to Gemini API. Possible issues:", {
        hasGeminiKey: !!process.env.GEMINI_API_KEY,
        modelUsed: 'gemini-1.5-flash',
        errorDetails: error.message
      });
    }
    res.status(500).json({ reply: "Sorry, I ran into an error. Please try again in a moment." });
  }
});

// Diagnostic endpoint to test Supabase connection
router.get('/diagnostic', async (req, res) => {
  const diagnostic = {
    timestamp: new Date().toISOString(),
    supabaseUrl: process.env.SUPABASE_URL ? '✅ Set' : '❌ Missing',
    supabaseKey: process.env.SUPABASE_KEY ? '✅ Set' : '❌ Missing',
    geminiApiKey: process.env.GEMINI_API_KEY ? '✅ Set' : '❌ Missing',
    geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    jwtSecret: process.env.JWT_SECRET ? '✅ Set' : '❌ Missing',
    tests: {}
  };

  try {
    // Test Supabase connection - check if tables exist
    const { data: users, error: usersError } = await supabase.from('Users').select('count', { count: 'exact', head: true });
    diagnostic.tests.usersTable = usersError ? `❌ ${usersError.message}` : '✅ Users table exists';

    const { data: prescriptions, error: presError } = await supabase.from('Prescriptions').select('count', { count: 'exact', head: true });
    diagnostic.tests.prescriptionsTable = presError ? `❌ ${presError.message}` : '✅ Prescriptions table exists';

    if (!process.env.GEMINI_API_KEY) {
      diagnostic.tests.geminiApi = '❌ GEMINI_API_KEY missing';
    } else {
      try {
        const geminiResponse = await callGeminiAPI([
          { role: 'user', content: 'Reply with exactly: OK' }
        ], 40);
        const hasChoice = !!geminiResponse?.choices?.[0];
        const content = geminiResponse?.choices?.[0]?.message?.content;
        diagnostic.tests.geminiApi = hasChoice
          ? `✅ Gemini API reachable${content ? ` (${content.trim().slice(0, 20)})` : ''}`
          : '⚠️ Gemini API reachable but returned no choices';
      } catch (geminiError) {
        diagnostic.tests.geminiApi = `❌ ${geminiError.message}`;
      }
    }

    // Test simple insert (this will fail if RLS is enabled without proper policies)
    console.log('🔍 Diagnostic Info:', diagnostic);
    res.json(diagnostic);
  } catch (error) {
    diagnostic.tests.connectionError = error.message;
    console.error('❌ Diagnostic error:', error);
    res.json(diagnostic);
  }
});

module.exports = router;
module.exports.extractPrescriptionWithRules = extractPrescriptionWithRules;
