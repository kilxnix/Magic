"""
MTG Scorer Adapter — Colab Training Script

Trains a LoRA adapter on Qwen3.5-4B-Instruct to rate card-commander fit (0-10).
Designed for Google Colab Pro with an A100 GPU (~1 hour estimated training time).

Usage (Colab):
    1. Upload this file and scorer_train.jsonl to your Colab session.
    2. Run cells top-to-bottom, or use File > Save a copy as notebook
       (Colab will treat each "# Cell N:" comment block as a cell).
    3. Adapter is saved to "mtg-scorer-adapter/".
    4. Merged model and GGUF are exported at the end.

Usage (standalone Python — for testing locally):
    python training/train_scorer.py

Input:  scorer_train.jsonl  (one {"messages": [...]} record per line)
Output: mtg-scorer-adapter/      — LoRA adapter weights
        mtg-scorer-merged/       — Full merged model (16-bit)
        mtg-scorer-gguf/         — GGUF Q8_0 for llama-cpp-python
"""

# ---------------------------------------------------------------------------
# Cell 1: Install dependencies
# ---------------------------------------------------------------------------

# In Colab, uncomment and run this cell first:
# !pip install unsloth

# ---------------------------------------------------------------------------
# Cell 2: Load Qwen3.5-4B-Instruct with Unsloth + LoRA
# ---------------------------------------------------------------------------

from unsloth import FastLanguageModel

MAX_SEQ_LENGTH = 512      # Scorer inputs are short (single card rating)
LOAD_IN_4BIT = True       # QLoRA — keeps VRAM under 16 GB on A100

model, tokenizer = FastLanguageModel.from_pretrained(
    model_name="Qwen/Qwen2.5-4B-Instruct",   # Qwen3.5-4B-Instruct when available on HF
    max_seq_length=MAX_SEQ_LENGTH,
    load_in_4bit=LOAD_IN_4BIT,
    dtype=None,            # Auto-detect: bfloat16 on A100
)

model = FastLanguageModel.get_peft_model(
    model,
    r=16,
    lora_alpha=32,
    target_modules=[
        "q_proj",
        "k_proj",
        "v_proj",
        "o_proj",
        "gate_proj",
        "up_proj",
        "down_proj",
    ],
    lora_dropout=0.05,
    bias="none",
    use_gradient_checkpointing="unsloth",   # Unsloth's memory-efficient checkpointing
    random_state=42,
    use_rslora=False,
    loftq_config=None,
)

print(model.print_trainable_parameters())

# ---------------------------------------------------------------------------
# Cell 3: Load scorer dataset
# ---------------------------------------------------------------------------

from datasets import load_dataset

dataset = load_dataset(
    "json",
    data_files="scorer_train.jsonl",
    split="train",
)

print(f"Loaded {len(dataset)} scorer training examples")
print("Sample record keys:", dataset[0].keys())

# ---------------------------------------------------------------------------
# Cell 4: Format chat — apply chat template to messages field
# ---------------------------------------------------------------------------

def format_chat(examples):
    """Convert messages list to a single tokenized text string using the chat template."""
    texts = []
    for messages in examples["messages"]:
        text = tokenizer.apply_chat_template(
            messages,
            tokenize=False,
            add_generation_prompt=False,
        )
        texts.append(text)
    return {"text": texts}

dataset = dataset.map(format_chat, batched=True, remove_columns=dataset.column_names)
print("Formatted sample:\n", dataset[0]["text"][:500])

# ---------------------------------------------------------------------------
# Cell 5: Train with SFTTrainer
# ---------------------------------------------------------------------------

from trl import SFTTrainer
from transformers import TrainingArguments

training_args = TrainingArguments(
    output_dir="mtg-scorer-adapter",
    per_device_train_batch_size=16,
    gradient_accumulation_steps=2,       # Effective batch = 32
    learning_rate=2e-4,
    num_train_epochs=3,
    bf16=True,                           # A100 supports bfloat16 natively
    warmup_ratio=0.05,
    logging_steps=50,
    save_strategy="epoch",
    save_total_limit=2,
    lr_scheduler_type="linear",
    seed=42,
    report_to="none",                    # Disable W&B by default; set to "wandb" if desired
)

trainer = SFTTrainer(
    model=model,
    tokenizer=tokenizer,
    train_dataset=dataset,
    dataset_text_field="text",
    max_seq_length=MAX_SEQ_LENGTH,
    dataset_num_proc=2,
    packing=True,                        # Pack short scorer examples for efficiency
    args=training_args,
)

trainer_stats = trainer.train()
print(f"Training complete. Steps: {trainer_stats.global_step}, "
      f"Loss: {trainer_stats.training_loss:.4f}")

# ---------------------------------------------------------------------------
# Cell 6: Save LoRA adapter
# ---------------------------------------------------------------------------

model.save_pretrained("mtg-scorer-adapter")
tokenizer.save_pretrained("mtg-scorer-adapter")
print("Adapter saved to mtg-scorer-adapter/")

# ---------------------------------------------------------------------------
# Cell 7: Merge weights and export to GGUF Q8_0
# ---------------------------------------------------------------------------

# Merge LoRA weights back into the base model (16-bit) for inference
model.save_pretrained_merged(
    "mtg-scorer-merged",
    tokenizer,
    save_method="merged_16bit",
)
print("Merged model saved to mtg-scorer-merged/")

# Export to GGUF Q8_0 for llama-cpp-python local inference (~5 GB)
model.save_pretrained_gguf(
    "mtg-scorer-gguf",
    tokenizer,
    quantization_method="q8_0",
)
print("GGUF model saved to mtg-scorer-gguf/")
print("Done! Upload mtg-scorer-gguf/ to your local models/Qwen35/adapters/mtg-scorer/")
