"""Binary prompts for the "Go with the Flow" majority game.

Each entry is pre-split into the headline question and two short answer
labels (kept to 2-3 words) — the frontend renders `question` in the header
and `option_a` / `option_b` as the two vote buttons verbatim, no client-side
string-splitting involved.
"""

from typing import TypedDict


class MajorityQuestion(TypedDict):
    question: str
    option_a: str
    option_b: str


MAJORITY_QUESTIONS: list[MajorityQuestion] = [
    {"question": "Sea or pool?", "option_a": "Sea", "option_b": "Pool"},
    {"question": "Regular Coke or Coke Zero?", "option_a": "Regular Coke", "option_b": "Coke Zero"},
    {"question": "Salty or sweet?", "option_a": "Salty", "option_b": "Sweet"},
    {"question": "Beer or wine?", "option_a": "Beer", "option_b": "Wine"},
    {"question": "Krembo: Cookie first or cream first?", "option_a": "Cookie first", "option_b": "Cream first"},
    {"question": "Pineapple on pizza: Yes or no?", "option_a": "Yes", "option_b": "No"},
    {"question": "Winter or summer?", "option_a": "Winter", "option_b": "Summer"},
    {"question": "Dogs or cats?", "option_a": "Dogs", "option_b": "Cats"},
    {"question": "Morning shower or evening shower?", "option_a": "Morning", "option_b": "Evening"},
    {"question": "Live concert or club party?", "option_a": "Concert", "option_b": "Club party"},
    {"question": "Mainstream or techno?", "option_a": "Mainstream", "option_b": "Techno"},
    {"question": "First date: Man pays - yes or no?", "option_a": "Yes", "option_b": "No"},
    {
        "question": "Platonic friendship with the opposite sex: Legit - yes or no?",
        "option_a": "Yes",
        "option_b": "No",
    },
    {"question": "Dating: Apps or meeting in real life?", "option_a": "Apps", "option_b": "Real life"},
    {"question": "Flight: Window seat or aisle seat?", "option_a": "Window", "option_b": "Aisle"},
    {"question": "Alarm clock: Snooze or get up immediately?", "option_a": "Snooze", "option_b": "Get up"},
    {"question": "Brushing teeth: Before coffee/food or after?", "option_a": "Before", "option_b": "After"},
    {"question": "Voice notes: x1.5 or x2 speed?", "option_a": "x1.5 speed", "option_b": "x2 speed"},
    {"question": "Believe in astrology: Yes or no?", "option_a": "Yes", "option_b": "No"},
    {"question": "Bamba: Regular or nougat?", "option_a": "Regular", "option_b": "Nougat"},
    {"question": "Pizza crust: Eat it or throw it away?", "option_a": "Eat it", "option_b": "Toss it"},
    {"question": "Avocado: Yes or no?", "option_a": "Yes", "option_b": "No"},
    {"question": "Battery at 50%: Charge it - yes or no?", "option_a": "Yes", "option_b": "No"},
    {"question": "Phone calls: Screen them or always answer?", "option_a": "Screen them", "option_b": "Always answer"},
    {
        "question": "Ignored a call on purpose and said it was on silent: Yes or no?",
        "option_a": "Yes",
        "option_b": "No",
    },
    {
        "question": "Popcorn at the movies: Start eating before the movie - yes or no?",
        "option_a": "Yes",
        "option_b": "No",
    },
    {"question": "Delete photos of the ex on Instagram: Yes or no?", "option_a": "Yes", "option_b": "No"},
    {
        "question": "Successful first date: Text immediately or play games?",
        "option_a": "Text right away",
        "option_b": "Play it cool",
    },
    {"question": "Peed in the pool: Yes or no?", "option_a": "Yes", "option_b": "No"},
    {"question": "Talked to myself when home alone: Yes or no?", "option_a": "Yes", "option_b": "No"},
    {
        "question": "Shirt worn once (and not dirty): Laundry or reuse?",
        "option_a": "Laundry",
        "option_b": "Reuse it",
    },
    {
        "question": "Entering a cold sea: Jump right in or go gradually?",
        "option_a": "Jump right in",
        "option_b": "Go gradually",
    },
    {
        "question": "Instagram story: Obsessively check who viewed it - yes or no?",
        "option_a": "Yes",
        "option_b": "No",
    },
    {
        "question": "Public restrooms: Line the seat with paper before sitting - yes or no?",
        "option_a": "Yes",
        "option_b": "No",
    },
    {"question": "Opened a fake Instagram account: Yes or no?", "option_a": "Yes", "option_b": "No"},
    {"question": "Parallel parking: On the first try - yes or no?", "option_a": "Yes", "option_b": "No"},
    {"question": "Phone on Dark Mode: Yes or no?", "option_a": "Yes", "option_b": "No"},
    {
        "question": "Important game or Valentine's Day: What do you choose?",
        "option_a": "The game",
        "option_b": "Valentine's Day",
    },
    {"question": "Opened the fridge twice in 5 minutes: Yes or no?", "option_a": "Yes", "option_b": "No"},
    {"question": "Stare at other drivers at a red light: Yes or no?", "option_a": "Yes", "option_b": "No"},
    {"question": "Stand-up show or music concert?", "option_a": "Stand-up", "option_b": "Concert"},
    {"question": "Afraid of cockroaches: Yes or no?", "option_a": "Yes", "option_b": "No"},
    {
        "question": "A million dollars in the bank or go back to age 20?",
        "option_a": "The money",
        "option_b": "Be 20 again",
    },
    {"question": "Horror movies: Love them or hate them?", "option_a": "Love them", "option_b": "Hate them"},
    {"question": "Blood tests: Afraid or not?", "option_a": "Afraid", "option_b": "Not afraid"},
]
